"""Feature engineering with explicit temporal semantics."""

from aerosphinx.features.lags import (
    LagSpec,
    calendar_lag,
    calendar_lags,
    calendar_rolling,
    calendar_rolling_stats,
    observation_age_days,
)

__all__ = [
    "LagSpec",
    "calendar_lag",
    "calendar_lags",
    "calendar_rolling",
    "calendar_rolling_stats",
    "observation_age_days",
]
