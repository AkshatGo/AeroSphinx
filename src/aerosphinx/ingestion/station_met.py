"""CPCB station-local meteorological ingestion (Phase 3 Workstream C).

The Phase 3 Workstream D audit established that the nine meteorological
columns in the CPCB export are genuine hourly station-local measurements.
This module aggregates them to daily values for the feature-group
experiments.

The aggregation is deliberately conservative:

* Out-of-range values are set to missing, not clipped.
* A day is accepted only when every constituent column has enough valid
  hours, so a partially-missing day does not silently mix a measured
  temperature with an interpolated one.
* The **measurement** timestamp is preserved. The **availability**
  timestamp remains UNKNOWN, because the export carries no publication
  metadata. Nothing here assumes a publication lag.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from aerosphinx.quality.station_audit import STATION_LOCAL_COLUMNS

__all__ = ["StationMetDaily", "load_station_met_daily"]

#: The internal column name for each audited CPCB column.
COLUMN_NAMES = {
    "AT (°C)": "AT",
    "RH (%)": "RH",
    "WS (m/s)": "WS",
    "WD (deg)": "WD",
    "RF (mm)": "RF",
    "TOT-RF (mm)": "TOT_RF",
    "SR (W/mt2)": "SR",
    "BP (mmHg)": "BP",
    "VWS (m/s)": "VWS",
}


@dataclass
class StationMetDaily:
    """Daily station-local meteorology plus its audit."""

    frame: pd.DataFrame
    availability_timestamp: str
    forecast_usable: bool
    notes: str
    coverage: dict


def load_station_met_daily(
    cpcb_dir: Path | str,
    min_hours_per_day: int = 18,
    max_age_days: int | None = None,
) -> StationMetDaily:
    """Aggregate the CPCB station-local meteorological columns to daily values.

    Parameters
    ----------
    cpcb_dir:
        Directory of CPCB CSV exports. Read-only.
    min_hours_per_day:
        Minimum valid hours for a day's value to be accepted.
    max_age_days:
        Not used for the strict variant; retained so the signature matches
        the other ingestions.

    Returns
    -------
    StationMetDaily
        The daily frame, the coverage statistics and the availability
        statement.
    """
    cpcb_dir = Path(cpcb_dir)
    frames = []
    for path in sorted(cpcb_dir.glob("*.csv")):
        raw = pd.read_csv(path)
        raw["_file"] = path.name
        frames.append(raw)

    if not frames:
        raise FileNotFoundError(f"No CPCB CSV files found in {cpcb_dir}")

    frame = pd.concat(frames, ignore_index=True)
    frame["_timestamp"] = pd.to_datetime(frame["Timestamp"], errors="coerce")
    frame["_date"] = frame["_timestamp"].dt.normalize()

    internal: dict[str, pd.Series] = {}
    for source, name in COLUMN_NAMES.items():
        if source not in frame.columns:
            continue
        values = pd.to_numeric(frame[source], errors="coerce")
        # The audited valid ranges, applied as a screen rather than a clip.
        valid = values.between(-50.0, 100.0) if name in {"AT", "RH"} else values.notna()
        values = values.where(valid)
        internal[name] = values

    daily = pd.DataFrame({"Date": frame["_date"]})
    for name, values in internal.items():
        daily[name] = values.to_numpy()

    grouped = daily.groupby("Date", sort=True)
    means = grouped.agg({name: "mean" for name in internal})
    counts = grouped.agg({name: "count" for name in internal}).add_suffix("_n")

    # Each column is accepted on its own coverage. Requiring every column
    # to be complete would discard 47% of the record because two columns
    # (barometric pressure and vertical wind speed) are themselves sparse;
    # a per-column rule keeps the well-measured variables usable and lets
    # the missingness of the sparse ones be carried as NaN, which the
    # tree models handle natively.
    valid_counts = pd.DataFrame({name: counts[f"{name}_n"] for name in internal})
    accepted_per_column = valid_counts >= min_hours_per_day
    n_columns_present = accepted_per_column.sum(axis=1)
    accepted = n_columns_present >= 1

    result = means.loc[accepted].copy()
    result["Date"] = result.index
    result = result.reset_index(drop=True)
    for name in internal:
        result[f"{name}_n"] = valid_counts.loc[accepted, name].to_numpy()
    result["n_columns_present"] = n_columns_present.loc[accepted].to_numpy()

    coverage = {
        "n_days_total": int(len(means)),
        "n_days_accepted": int(accepted.sum()),
        "coverage_fraction": float(accepted.mean()) if len(means) else 0.0,
        "per_column_accepted_days": {
            name: int(accepted_per_column[name].sum()) for name in internal
        },
        "per_column_missing_fraction": {
            name: round(float(1.0 - accepted_per_column[name].mean()), 4)
            for name in internal
        },
        "mean_columns_present_per_accepted_day": (
            round(float(n_columns_present[accepted].mean()), 3) if accepted.any() else 0.0
        ),
    }

    return StationMetDaily(
        frame=result,
        availability_timestamp="UNKNOWN",
        forecast_usable=False,
        notes=(
            "RETROSPECTIVE ONLY. The CPCB export carries no publication or "
            "upload timestamp, so the time at which each value became "
            "available to a forecaster is unknown. No publication lag is "
            "assumed. The measurement time is preserved as the row date."
        ),
        coverage=coverage,
    )
