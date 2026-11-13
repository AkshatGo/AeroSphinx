"""Feature engineering with explicit temporal semantics."""

from aerosphinx.features.availability import (
    SOURCE_GROUPS,
    FusedDataset,
    FusionRules,
    assert_fusion_alignment,
    build_fused_dataset,
    validate_fused_dataset,
)
from aerosphinx.features.lags import (
    LagSpec,
    calendar_lag,
    calendar_lags,
    calendar_rolling,
    calendar_rolling_stats,
    observation_age_days,
)

__all__ = [
    "SOURCE_GROUPS",
    "FusedDataset",
    "FusionRules",
    "assert_fusion_alignment",
    "build_fused_dataset",
    "validate_fused_dataset",
    "LagSpec",
    "calendar_lag",
    "calendar_lags",
    "calendar_rolling",
    "calendar_rolling_stats",
    "observation_age_days",
]
