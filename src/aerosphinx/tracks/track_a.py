"""Track A - historical CPCB-based PM2.5 forecasting.

This module runs the Phase 2 experiments over the full nine-year CPCB
record using rolling-origin backtesting.

Experiments
-----------
======  ==================================  ==================================
ID      Inputs                               Question
======  ==================================  ==================================
A0      Previous-day PM2.5                   Persistence baseline
A1      Day-of-year climatology              Seasonal baseline
A2      Historical PM2.5 + temporal +        Does temporal ML beat
        calendar features                    persistence?
======  ==================================  ==================================

Every model is scored on **identical test rows** within a fold, and every
comparison against the baseline is reported with a paired test and a
bootstrap interval, per ``docs/EXPERIMENT_PROTOCOL.md`` section 5.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from aerosphinx.evaluation.metrics import evaluate
from aerosphinx.evaluation.splits import Fold, rolling_origin_folds
from aerosphinx.evaluation.uncertainty import compare_models
from aerosphinx.models.baselines import (
    PersistenceBaseline,
    SeasonalNaiveBaseline,
    persistence_forecast,
)
from aerosphinx.models.supervised import build_model
from aerosphinx.tracks.diagnostics import cold_start_report, coverage_by_fold

__all__ = ["TrackAResult", "run_track_a", "DEFAULT_FEATURES"]


# The A2 feature set: calendar-aware PM2.5 history plus cyclic calendar
# encodings. Station-local meteorology is deliberately excluded until its
# provenance is confirmed (see docs/SCIENTIFIC_ASSUMPTIONS.md H4).
DEFAULT_FEATURES = [
    "PM25_Lag_1",
    "PM25_Lag_2",
    "PM25_Lag_3",
    "PM25_Lag_7",
    "PM25_Roll3",
    "PM25_Roll7",
    "day_sin",
    "day_cos",
    "month_sin",
    "month_cos",
]


@dataclass
class TrackAResult:
    """Outcome of a Track A run."""

    predictions: pd.DataFrame
    fold_metrics: pd.DataFrame
    comparisons: pd.DataFrame
    aggregate: pd.DataFrame
    fold_summary: pd.DataFrame
    coverage: pd.DataFrame = field(default_factory=pd.DataFrame)
    cold_start: pd.DataFrame = field(default_factory=pd.DataFrame)
    fold_complete: pd.DataFrame = field(default_factory=pd.DataFrame)
    metadata: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "metadata": self.metadata,
            "aggregate": self.aggregate.to_dict(orient="records"),
            "fold_summary": self.fold_summary.to_dict(orient="records"),
            "comparisons": self.comparisons.to_dict(orient="records"),
        }


def _season(dates: pd.Series) -> pd.Series:
    """Meteorological season labels for northern India."""
    month = dates.dt.month
    return pd.Series(
        np.select(
            [
                month.isin([12, 1, 2]),
                month.isin([3, 4, 5]),
                month.isin([6, 7, 8, 9]),
                month.isin([10, 11]),
            ],
            ["winter", "pre_monsoon", "monsoon", "post_monsoon"],
            default="unknown",
        ),
        index=dates.index,
    )


def run_track_a(
    frame: pd.DataFrame,
    features: list[str] | None = None,
    models: list[str] | None = None,
    min_train_days: int = 365,
    validation_days: int = 0,
    test_block_days: int = 30,
    step_days: int = 30,
    baseline: str = "persistence",
    climatology_lookback_years: int = 3,
    select_climatology_lookback: bool = True,
    persistence_max_age_days: int | None = None,
    bootstrap_samples: int = 10000,
    alpha: float = 0.05,
    seed: int = 42,
    date_column: str = "Date",
    target: str = "PM25",
) -> TrackAResult:
    """Run the Track A rolling-origin backtest.

    Parameters
    ----------
    frame:
        The daily series with engineered features. Must contain the target
        and every feature.
    features:
        Feature columns for the learned models.
    models:
        Names of supervised models to fit, from
        ``aerosphinx.models.supervised.MODEL_REGISTRY``.
    min_train_days:
        Length of the first training block.
    validation_days:
        Length of the validation block; 0 disables it.
    test_block_days:
        Length of each test block.
    step_days:
        How far the origin advances between folds.
    baseline:
        The reference model for paired comparisons.
    climatology_lookback_years:
        Years of history used by the seasonal baseline.
    persistence_max_age_days:
        When set, the persistence baseline may reach back up to this many
        days. This widens the evaluation set to rows whose previous calendar
        day is missing.
    bootstrap_samples:
        Bootstrap resamples for confidence intervals.
    alpha:
        Significance level.
    seed:
        Seed for the bootstrap, for reproducibility.

    Returns
    -------
    TrackAResult
        Per-observation predictions, per-fold metrics, paired comparisons
        against the baseline, and aggregate metrics.
    """
    features = list(features or DEFAULT_FEATURES)
    models = list(models or ["ridge", "random_forest", "xgboost"])

    data = frame.copy()
    data[date_column] = pd.to_datetime(data[date_column])
    data = data.sort_values(date_column).reset_index(drop=True)

    missing = [f for f in features if f not in data.columns]
    if missing:
        raise KeyError(f"frame is missing feature columns: {missing}")
    if target not in data.columns:
        raise KeyError(f"frame is missing the target column {target!r}")

    folds = rolling_origin_folds(
        data,
        min_train_days=min_train_days,
        validation_days=validation_days,
        test_block_days=test_block_days,
        step_days=step_days,
        date_column=date_column,
    )
    if not folds:
        raise ValueError(
            "no folds could be constructed; reduce min_train_days or "
            "test_block_days"
        )

    prediction_rows: list[pd.DataFrame] = []
    metric_rows: list[dict] = []

    for fold in folds:
        train, validation, test = fold.split(data, date_column)
        if train.empty or test.empty:
            continue

        # Every model is scored on exactly the same test rows. The rows are
        # those where the target is observed and the baseline can be
        # computed.
        observed_test = test[test[target].notna()].copy()
        if observed_test.empty:
            continue

        fold_predictions = pd.DataFrame({"Date": observed_test[date_column].to_numpy()})
        fold_predictions["Fold"] = fold.index
        fold_predictions["Target"] = observed_test[target].to_numpy()

        # --- A0: persistence -------------------------------------------
        persistence = PersistenceBaseline(value_column=target, date_column=date_column)
        persistence.fit(train)
        fold_predictions["persistence"] = persistence.predict(observed_test)

        # --- A1: seasonal climatology ----------------------------------
        # The lookback window is selected on an inner validation block
        # carved from the training data, so no test observation influences
        # the choice.
        seasonal = SeasonalNaiveBaseline(
            lookback_years=climatology_lookback_years,
            value_column=target,
            date_column=date_column,
        )
        if select_climatology_lookback:
            seasonal.select_lookback(train)
            seasonal.fit(train)
        else:
            seasonal.fit(train)
        fold_predictions["seasonal_naive"] = seasonal.predict(observed_test)
        fold_predictions["seasonal_lookback"] = seasonal.selected_lookback or 0

        # --- A2: learned models ----------------------------------------
        for model_name in models:
            model = build_model(model_name, features, target=target)
            model.fit(train)
            fold_predictions[model_name] = model.predict(observed_test)

        prediction_rows.append(fold_predictions)

        # Per-fold metrics, on the rows where the baseline is defined.
        comparable = fold_predictions[fold_predictions[baseline].notna()]
        if comparable.empty:
            continue
        y = comparable["Target"].to_numpy()
        for model_name in fold_predictions.columns:
            if model_name in ("Date", "Fold", "Target", "seasonal_lookback"):
                continue
            scores = evaluate(y, comparable[model_name].to_numpy())
            metric_rows.append(
                {
                    "fold": fold.index,
                    "model": model_name,
                    "train_start": fold.train_start.date().isoformat(),
                    "train_end": fold.train_end.date().isoformat(),
                    "test_start": fold.test_start.date().isoformat(),
                    "test_end": fold.test_end.date().isoformat(),
                    **scores,
                }
            )

    if not prediction_rows:
        raise ValueError("no fold produced usable test predictions")

    predictions = pd.concat(prediction_rows, ignore_index=True)
    fold_metrics = pd.DataFrame(metric_rows)

    # The headline evaluation set: rows where every compared model and the
    # baseline are all defined, so every model is scored on identical rows.
    model_columns = [
        c for c in predictions.columns
        if c not in ("Date", "Fold", "Target", "seasonal_lookback")
    ]
    complete = predictions.dropna(subset=model_columns + ["Target"])
    complete = complete.reset_index(drop=True)

    aggregate_rows = []
    for model_name in model_columns:
        scores = evaluate(complete["Target"].to_numpy(), complete[model_name].to_numpy())
        aggregate_rows.append({"model": model_name, **scores})
    aggregate = pd.DataFrame(aggregate_rows)

    comparisons = compare_models(
        complete["Target"].to_numpy(),
        {name: complete[name].to_numpy() for name in model_columns},
        baseline=baseline,
        n_samples=bootstrap_samples,
        alpha=alpha,
        seed=seed,
    )

    # Seasonal and per-year breakdowns, on the same complete rows.
    fold_summary = _fold_summary(fold_metrics, complete, model_columns, date_column)

    # Regime-coverage diagnostics: which folds forced the models to
    # extrapolate outside their training range?
    coverage = coverage_by_fold(data, folds, target, date_column)
    cold_start = cold_start_report(fold_metrics, coverage, baseline)

    # Fold-level aggregate metrics on the *complete* evaluation rows, which
    # is the set every model is judged on.
    fold_complete = _fold_complete_metrics(
        predictions, model_columns, target, baseline
    )

    metadata = {
        "n_folds": len(folds),
        "n_rows_total": int(len(predictions)),
        "n_rows_evaluated": int(len(complete)),
        "n_rows_excluded_missing_baseline": int(len(predictions) - len(complete)),
        "features": features,
        "models": models,
        "baseline": baseline,
        "climatology_lookback_years": climatology_lookback_years,
        "select_climatology_lookback": select_climatology_lookback,
        "persistence_max_age_days": persistence_max_age_days,
        "min_train_days": min_train_days,
        "validation_days": validation_days,
        "test_block_days": test_block_days,
        "step_days": step_days,
        "bootstrap_samples": bootstrap_samples,
        "alpha": alpha,
        "seed": seed,
        "date_range": [
            complete["Date"].min().date().isoformat(),
            complete["Date"].max().date().isoformat(),
        ],
        "n_folds_extrapolating": int(coverage["extrapolating"].sum())
        if not coverage.empty
        else 0,
    }

    return TrackAResult(
        predictions=predictions,
        fold_metrics=fold_metrics,
        comparisons=comparisons,
        aggregate=aggregate,
        fold_summary=fold_summary,
        coverage=coverage,
        cold_start=cold_start,
        fold_complete=fold_complete,
        metadata=metadata,
    )


def _fold_complete_metrics(
    predictions: pd.DataFrame,
    model_columns: list[str],
    target: str,
    baseline: str,
) -> pd.DataFrame:
    """Per-fold metrics on the complete evaluation rows.

    ``fold_metrics`` scores each fold on whatever rows that fold produced.
    This table restricts to rows where every model is defined, so the
    per-fold numbers are directly comparable with the aggregate.
    """
    rows = []
    for fold_index, group in predictions.groupby("Fold"):
        usable = group.dropna(subset=model_columns + ["Target"])
        if usable.empty:
            continue
        y = usable["Target"].to_numpy()
        for model_name in model_columns:
            scores = evaluate(y, usable[model_name].to_numpy())
            row = {"fold": int(fold_index), "model": model_name, **scores}
            rows.append(row)

    if not rows:
        return pd.DataFrame()

    table = pd.DataFrame(rows)
    pivot = table.pivot_table(index="fold", columns="model", values="MAE")
    if baseline in pivot.columns:
        for column in pivot.columns:
            if column != baseline:
                table[f"{column}_minus_{baseline}"] = table.apply(
                    lambda row: row["MAE"]
                    - pivot.loc[row["fold"], baseline]
                    if row["model"] == column
                    else np.nan,
                    axis=1,
                )
    return table


def _fold_summary(
    fold_metrics: pd.DataFrame,
    complete: pd.DataFrame,
    model_columns: list[str],
    date_column: str,
) -> pd.DataFrame:
    """Per-model stability across folds: mean, sd and worst-case MAE.

    A model whose fold-to-fold MAE varies wildly is not a reliable
    forecurer, however good its mean is. This is the stability dimension
    the single-window legacy evaluation could not show.
    """
    rows = []
    for model_name, group in fold_metrics.groupby("model"):
        maes = group["MAE"].to_numpy()
        r2s = group["R2"].to_numpy()
        rows.append(
            {
                "model": model_name,
                "n_folds": int(len(group)),
                "MAE_mean": float(np.mean(maes)),
                "MAE_sd": float(np.std(maes, ddof=1)) if len(maes) > 1 else 0.0,
                "MAE_min": float(np.min(maes)),
                "MAE_max": float(np.max(maes)),
                "MAE_worst_fold_ratio": (
                    float(np.max(maes) / np.mean(maes)) if np.mean(maes) > 0 else float("nan")
                ),
                "R2_mean": float(np.nanmean(r2s)),
                "R2_min": float(np.nanmin(r2s)),
                "folds_with_negative_R2": int(np.sum(r2s < 0)),
            }
        )
    return pd.DataFrame(rows).sort_values("MAE_mean").reset_index(drop=True)
