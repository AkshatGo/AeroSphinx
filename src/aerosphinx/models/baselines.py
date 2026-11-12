"""Baseline models for AeroSphinx.

Baselines are the reference against which every learned model is judged.
They are not throwaway: the Phase 0 audit found that the legacy pipeline's
climatology baseline was mis-specified (bias -35.85 ug/m3), which flattered
every model compared against it.

Every baseline here consumes only information available **before** the
target date, and each is fitted on the training block of its fold only.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

__all__ = [
    "PersistenceBaseline",
    "SeasonalNaiveBaseline",
    "ClimatologyBuilder",
    "persistence_forecast",
]


class PersistenceBaseline:
    """A0 - predict tomorrow's PM2.5 as today's PM2.5.

    The naive benchmark every forecasting system must beat. Under the
    calendar-aware contract, "today" is the observation dated exactly one
    calendar day before the target; where that day is absent the baseline
    returns NaN rather than reaching further back.
    """

    name = "persistence"

    def __init__(self, value_column: str = "PM25", date_column: str = "Date"):
        self.value_column = value_column
        self.date_column = date_column

    def fit(self, frame: pd.DataFrame) -> "PersistenceBaseline":
        """Nothing to fit; the baseline is parameter-free."""
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        """Predict using the previous calendar day's observation."""
        from aerosphinx.features.lags import calendar_lag

        lag = calendar_lag(frame, self.value_column, 1)
        return lag.to_numpy(dtype=float)


class ClimatologyBuilder:
    """Day-of-year climatology built from a training block.

    The correction for **D-005**: the legacy baseline averaged every year
    of history for each day-of-year, which under-predicted the 2024 test
    window by 35.85 ug/m3 because the window sat in a higher-PM2.5 period
    than the long-run average.

    Two changes follow:

    1. Only the most recent ``lookback_years`` years are used, so the
       baseline tracks the current regime rather than a decade-average.
    2. The baseline's own bias is reported, so a shared systematic offset
       cannot hide inside a relative comparison.

    The climatology is always fitted on training data only. A day-of-year
    key that is absent from the training block falls back to the nearest
    available key within ``max_day_offset`` days.
    """

    def __init__(
        self,
        lookback_years: int = 3,
        max_day_offset: int = 3,
        value_column: str = "PM25",
        date_column: str = "Date",
    ):
        if lookback_years < 1:
            raise ValueError("lookback_years must be at least 1")
        self.lookback_years = lookback_years
        self.max_day_offset = max_day_offset
        self.value_column = value_column
        self.date_column = date_column
        self._table: pd.Series | None = None
        self._fitted_end: pd.Timestamp | None = None

    def fit(self, frame: pd.DataFrame) -> "ClimatologyBuilder":
        """Build the climatology from the given (training) observations."""
        data = frame[[self.date_column, self.value_column]].copy()
        data[self.date_column] = pd.to_datetime(data[self.date_column])
        data = data.dropna(subset=[self.value_column])
        if data.empty:
            self._table = pd.Series(dtype=float)
            self._fitted_end = None
            return self

        # Restrict to the most recent ``lookback_years`` distinct years.
        years = data[self.date_column].dt.year
        cutoff_year = years.max() - self.lookback_years + 1
        data = data[years >= cutoff_year]

        data["day_of_year"] = data[self.date_column].dt.day_of_year
        self._table = data.groupby("day_of_year")[self.value_column].mean()
        self._fitted_end = data[self.date_column].max()
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        """Predict each row from its day-of-year climatological mean."""
        if self._table is None or self._table.empty:
            return np.full(len(frame), np.nan)

        dates = pd.to_datetime(frame[self.date_column])
        keys = dates.dt.day_of_year.to_numpy()

        predictions = np.full(len(frame), np.nan)
        available = np.array(sorted(self._table.index))
        values = self._table.to_dict()

        for position, key in enumerate(keys):
            if key in values:
                predictions[position] = values[key]
                continue
            # Nearest available day-of-year within the permitted offset.
            nearest = available[np.abs(available - key) <= self.max_day_offset]
            if nearest.size:
                predictions[position] = values[int(nearest[np.argmin(np.abs(nearest - key))])]

        return predictions

    @property
    def fitted_end(self) -> pd.Timestamp | None:
        """Latest observation date used to build the climatology."""
        return self._fitted_end


class SeasonalNaiveBaseline:
    """A1 - predict from the day-of-year climatology.

    A stronger baseline than persistence, because it captures the strong
    seasonal cycle in Delhi-NCR PM2.5. It is fitted per fold on training
    data only.

    The lookback window is a genuine trade-off and must be chosen on
    validation data, not asserted:

    * A **long** lookback averages more years, giving a smoother
      climatology with lower variance, but it also blends in earlier
      regimes whose pollution levels differed.
    * A **short** lookback tracks the current regime but is noisier, and on
      a single year it can miss a day-of-year entirely.

    :meth:`select_lookback` chooses between them using an inner validation
    block carved out of the training data, so no test observation
    influences the choice.
    """

    name = "seasonal_naive"

    def __init__(
        self,
        lookback_years: int | None = 3,
        max_day_offset: int = 3,
        value_column: str = "PM25",
        date_column: str = "Date",
    ):
        self.lookback_years = lookback_years
        self.max_day_offset = max_day_offset
        self.value_column = value_column
        self.date_column = date_column
        self.builder = ClimatologyBuilder(
            lookback_years=lookback_years or 3,
            max_day_offset=max_day_offset,
            value_column=value_column,
            date_column=date_column,
        )
        self.selected_lookback: int | None = None

    def fit(self, frame: pd.DataFrame) -> "SeasonalNaiveBaseline":
        self.builder.fit(frame)
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        return self.builder.predict(frame)

    def select_lookback(
        self,
        frame: pd.DataFrame,
        candidates: tuple[int, ...] = (1, 2, 3, 5, 9),
        validation_fraction: float = 0.2,
    ) -> int:
        """Choose the lookback window on an inner validation block.

        The training frame is split chronologically: the earlier part fits
        the climatology and the later part scores it. The lookback with the
        lowest validation MAE wins. No test observation is involved.

        Returns
        -------
        int
            The selected lookback in years.
        """
        if not candidates:
            raise ValueError("candidates cannot be empty")
        if not 0 < validation_fraction < 1:
            raise ValueError("validation_fraction must be between 0 and 1")

        data = frame[[self.date_column, self.value_column]].copy()
        data[self.date_column] = pd.to_datetime(data[self.date_column])
        data = data.sort_values(self.date_column).reset_index(drop=True)
        if len(data) < 20:
            self.selected_lookback = self.lookback_years or 3
            return self.selected_lookback

        split = int(len(data) * (1 - validation_fraction))
        inner_train = data.iloc[:split]
        inner_validation = data.iloc[split:]

        scores: dict[int, float] = {}
        for candidate in candidates:
            builder = ClimatologyBuilder(
                lookback_years=candidate,
                max_day_offset=self.max_day_offset,
                value_column=self.value_column,
                date_column=self.date_column,
            ).fit(inner_train)
            predictions = builder.predict(inner_validation)
            valid = pd.notna(predictions) & inner_validation[self.value_column].notna()
            if not valid.any():
                scores[candidate] = float("inf")
                continue
            errors = np.abs(
                inner_validation[self.value_column].to_numpy()[valid]
                - predictions[valid]
            )
            scores[candidate] = float(errors.mean())

        best = min(scores, key=lambda key: (scores[key], key))
        self.selected_lookback = int(best)
        self.lookback_years = int(best)
        self.builder = ClimatologyBuilder(
            lookback_years=int(best),
            max_day_offset=self.max_day_offset,
            value_column=self.value_column,
            date_column=self.date_column,
        )
        return self.selected_lookback


def persistence_forecast(
    frame: pd.DataFrame,
    value_column: str = "PM25",
    date_column: str = "Date",
    max_age_days: int | None = None,
) -> np.ndarray:
    """Persistence prediction with an optional staleness allowance.

    With ``max_age_days=None`` this is the strict calendar-aware baseline:
    the previous calendar day, or NaN where that day is absent.

    With ``max_age_days`` set, the most recent observation at or before the
    previous calendar day is used, provided it is no more than
    ``max_age_days`` old. This is the operationally realistic variant - a
    forecaster would use the latest observation it has - and it is reported
    alongside the strict variant so the effect of the 123 calendar gaps on
    the evaluation set is visible rather than hidden.
    """
    from aerosphinx.features.lags import calendar_lag

    if max_age_days is None:
        return calendar_lag(frame, value_column, 1).to_numpy(dtype=float)

    dates = pd.to_datetime(frame[date_column])
    values = pd.to_numeric(frame[value_column], errors="coerce")

    observed_index = pd.DatetimeIndex(dates)
    # For each target date, find the most recent observation at or before
    # the *previous calendar day*, then apply the staleness limit.
    targets = observed_index - pd.Timedelta(days=1)
    positions = observed_index.get_indexer(targets, method="ffill")

    predictions = np.full(len(frame), np.nan)
    valid = positions >= 0
    last_observed = observed_index[positions[valid]]
    age = (targets[valid] - last_observed).days
    within = age <= max_age_days
    rows = np.flatnonzero(valid)[within]
    predictions[rows] = values.to_numpy()[positions[valid][within]]

    return predictions
