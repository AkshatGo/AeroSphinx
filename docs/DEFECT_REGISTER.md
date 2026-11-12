# AeroSphinx — Defect Register

Phase 0 repository autopsy. Every entry below is classified as **VERIFIED**
(directly supported by evidence reproduced in this repository), **INFERRED**
(logically derived but not directly confirmed) or **BLOCKED** (cannot be
settled without data or permission that is not available).

Machine-readable evidence: `results/baseline/data_audit.json`,
`results/baseline/manifest.json`.

Severity reflects scientific impact on the research claims, not code aesthetics.

## Resolution status

| Defect | Severity | Status | Resolved in |
|---|---|---|---|
| D-001 Row-based PM2.5 lags are not calendar-aware | Critical | **FIXED** | Phase 1 — `src/aerosphinx/features/lags.py` |
| D-002 Forecast consumes future observed satellite/reanalysis data | Critical | OPEN | Phase 8 |
| D-003 Forward-fill manufactures environmental observations | High | OPEN | Phase 6 |
| D-004 27 INSAT granules contribute zero valid pixels | High | OPEN | Phase 4 |
| D-005 Climatology baseline mis-specified | High | **FIXED** (Phase 2) | `src/aerosphinx/models/baselines.py` |
| D-006 Improvement over persistence not significant | High | **ADDRESSED** (Phase 2) | `src/aerosphinx/evaluation/uncertainty.py` |
| D-007 Fusion does not beat the ground-only ablation | High | OPEN (finding, not a code defect) | Phase 7 |
| D-008 PBLH unavailable; `PBLTOP` fallback is a latent trap | Medium | OPEN | Phase 5 |
| D-009 `Humidity_Ratio` mis-named and mis-defined | Medium | OPEN | Phase 5 |
| D-010 MERRA-2 features are midday single-cell values | Medium | OPEN | Phase 5 |
| D-011 Feature importance dominated by `month_sin` | Medium | **PARTIALLY ADDRESSED** (Phase 2) | `docs/PHASE2_REPORT.md` |
| D-012 Duplicate CPCB source files | Medium | **FIXED** | Phase 0 — `legacy/`, `data/cpcb/` |
| D-013 Mean-of-file-means aggregation is unsafe | Medium | **FIXED** | Phase 1 — `src/aerosphinx/ingestion/cpcb.py` |
| D-014 Legacy pipelines absent from the worktree | Medium | **FIXED** | Phase 0 — `legacy/` |
| D-015 CRLF line-ending conversion | Low | Documented, no action required | — |
| D-016 Operational forecast extrapolates an upward drift | Low | OPEN | Phase 8 |

---

## D-001 — Row-based PM2.5 lags are not calendar-aware

| | |
|---|---|
| **Severity** | Critical |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:427-430` (`engineer_features`) |
| **Evidence** | `results/baseline/data_audit.json` → `cpcb.rows_where_lag1_is_not_previous_calendar_day` |

**Observed behaviour.** Lags are computed with `out[TARGET].shift(lag)`, which
advances by *row position*, not by calendar day. The accepted CPCB daily series
has **123 calendar gaps**, so for 123 of 2979 rows the value labelled
`PM25_Lag_1` is not the previous calendar day. The worst case is **25 days**
old (2017-10-09 → 2017-11-03). `PM25_Roll3` and `PM25_Roll7` inherit the same
defect through the same shift-then-roll construction.

**Impact.** A feature advertised as "PM2.5 on day t-1" can in fact be a
3-week-old observation. This inflates apparent temporal skill wherever the
series is gappy, and directly contradicts the plan's requirement that "a
missing date must not make a two-day-old observation masquerade as yesterday's
measurement". It also makes `PM25_Roll3`/`PM25_Roll7` semantically undefined
whenever a gap falls inside the window.

**Proposed correction.** Re-index the daily frame onto a complete
`date_range` before computing lags, or use `Series.reindex(dates).shift(lag)`
against an explicit calendar. Carry an `observation_age_days` column so
staleness is visible to the model and to the reader.

**Test proving the correction.** A unit test asserting that for every row the
value in `PM25_Lag_1` equals the observation dated exactly one calendar day
earlier, and that rows whose previous calendar day is missing carry `NaN`
rather than a stale value.

**Resolution applied (Phase 1).** `src/aerosphinx/features/lags.py` implements
`calendar_lag`, `calendar_lags`, `calendar_rolling`, `calendar_rolling_stats`
and `observation_age_days`. Every temporal feature reindexes onto the full
calendar before shifting, so a missing date becomes an explicit `NaN` row
rather than being bridged by a row-position shift. On the real record this
changes **123 rows** from a stale value (mean 3.5 days old, worst case
**25 days**) to `NaN`.

Proof tests: `tests/unit/test_lags.py` (including
`test_row_based_shift_would_have_been_wrong`, which pins the legacy defect so
it cannot silently return) and
`tests/integration/test_track_a_ingestion.py::test_calendar_aware_lag_rejects_stale_values`.

---

## D-002 — The 5-day "forecast" consumes future observed satellite and reanalysis data

| | |
|---|---|
| **Severity** | Critical |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:774` (`recursive_forecast`), `aerosphinx_pipeline.py:833-843` (`forward_forecast`) |
| **Evidence** | Reproduced directly; see `docs/REPOSITORY_AUDIT.md` §5 |

**Observed behaviour.** `recursive_forecast` reads the target day's row
directly from the merged observation frame:

```python
row = _update_recursive_features(source.loc[forecast_date], history)
```

That row carries the **observed** AOD and **observed** MERRA-2 values for the
forecast day itself. With a forecast origin of 2024-06-16, the model received
genuine satellite AOD for 2024-06-17 and 2024-06-18 and a *forward-filled*
AOD value for 2024-06-19 through 2024-06-21. The docstring states that
"meteorological and calendar inputs are taken as given, matching the chapter's
assumption that forward meteorology is supplied by an external forecast
product" — but no external forecast product exists in this repository. The
values are reanalysis and satellite observations from the future.

`forward_forecast` has the mirror-image problem: it persists the last
observed meteorological values forward and labels them
`"persisted from <date>"`. That label is honest, but the resulting numbers are
not forecasts.

**Impact.** This is the single largest scientific risk in the repository. The
five-day forecast table and Figure 7 present retrospective estimation as
operational forecasting. Under the plan's availability contract, future
observed AOD and future observed reanalysis are **forbidden** inputs to an
operational forecast. As shipped, the pipeline cannot produce a valid
operational forecast at all.

**Proposed correction.** Split the feature contract explicitly into a
retrospective mode and an operational mode. Track B retrospective estimation
may use same-day observed AOD/MERRA. Any operational forecast must carry an
explicit issue timestamp, may only use covariates genuinely available at that
timestamp, and must fall back to a CPCB-only model when future covariates are
unavailable.

**Test proving the correction.** A leakage test asserting that no feature
value used at forecast step *h* derives from an observation dated after the
forecast issue time.

---

## D-003 — Free forward-fill silently manufactures environmental observations

| | |
|---|---|
| **Severity** | High |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:407-408` (`harmonise`) |
| **Evidence** | `results/baseline/data_audit.json` → `alignment.rows_with_forward_filled_aod` |

**Observed behaviour.** After merging the three sources, `harmonise` applies
`ffill(limit=3)` to AOD and every MERRA-2 variable. The filled rows are
indistinguishable from genuinely observed rows in the modelling frame: there
is no source-presence indicator, no observation-age column, and no record of
which values were imputed. Of the 166 modelling rows, **7 carry a
forward-filled AOD value** and 1 carries a forward-filled MERRA-2 value.

**Impact.** The plan requires that "never silently fill missing environmental
measurements with fabricated values" and that each prediction record its
"feature availability timestamps" and "source coverage and missingness". A
forward-filled AOD is a stale value presented as a contemporaneous one, which
is exactly the failure mode that an availability-aware model must not
inherit. It also distorts the multisource ablation, because a "fusion" model
may be partly running on imputed satellite inputs while the ground-only
comparison sees real observations.

**Proposed correction.** Replace filling with an explicit availability mask.
Emit `aod_observed`, `merra_observed` and per-source `observation_age_days`
columns; never substitute a value for a missing observation in a model that
claims to use it.

**Test proving the correction.** A test asserting that no modelling row
contains an AOD or MERRA-2 value that is not backed by a same-day source
record, unless the row is explicitly flagged as imputed.

---

## D-004 — 27 of 169 INSAT granules contribute zero valid pixels

| | |
|---|---|
| **Severity** | High |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:314-325` (`load_aod_daily`) |
| **Evidence** | `results/baseline/data_audit.json` → `insat_aod.granules_with_zero_valid_pixels` |

**Observed behaviour.** The station collocation window is +/-0.25 degrees
around 28.4089 N, 77.3178 E on a 0.1-degree INSAT-3D grid, i.e. at most
5 x 5 = 25 pixels. Across 169 granules, **27 yield no valid pixel at all**
inside that window (fill value -999 throughout), and the median granule
contributes only **12** valid pixels. The pipeline records `aod_valid_pixels`
but never uses it as a feature, a filter, or a reported confidence measure.

**Impact.** A daily AOD value derived from a single pixel is not a station
representative measurement, yet it enters the model as an ordinary covariate
with no indication of its support. This is the plan's requirement to "report
valid pixel coverage for every date" and to treat coverage as a first-class
signal. The absence of any QA or cloud-flag dataset in the granules
(`has_qa_flag_dataset: false`) means there is no way to distinguish "clear
sky, low aerosol" from "partially cloudy, retrieval uncertain" using these
files.

**Proposed correction.** Add `aod_valid_pixels` and `aod_coverage_fraction`
as features and as a documented quality gate, and report the distribution of
pixel support alongside every satellite-derived result.

---

## D-005 — Climatology baseline is mis-specified and materially under-predicts

| | |
|---|---|
| **Severity** | High |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:632-638` (`run_baselines`) |
| **Evidence** | Reproduced: MAE 35.87, bias -35.85 against observed mean 100.63 |

**Observed behaviour.** The seasonal-naive baseline groups **all** CPCB
history by day-of-year and averages across years, then maps test dates
through that average. The test window (17 May - 18 June 2024) happens to sit
in a high-PM2.5 period relative to the 2016-2023 mean for the same
day-of-year, so the baseline predicts a mean of 64.78 against an observed
mean of 100.63 — a systematic under-prediction of -35.85 ug/m3, MAE 35.87 and
R2 of -2.68.

**Impact.** A baseline that is this badly mis-calibrated makes every other
model look competent by comparison. It flatters the ensemble (MAE 17.30)
without any real evidence that the ensemble is skilful. The plan explicitly
warns that "a small number of test days means large uncertainty" and requires
baselines that are meaningful comparators.

**Proposed correction.** Build the seasonal baseline from the most recent
available years only (or use a quantile-matched climatology), and report the
baseline's own bias so that a shared systematic offset cannot hide inside a
relative comparison.

**Resolution applied (Phase 2).** `ClimatologyBuilder` restricts the
climatology to a configurable lookback window and reports its own fitted
range. `SeasonalNaiveBaseline.select_lookback` chooses the lookback **per
fold on an inner validation block** carved from the training data, so no test
observation influences the choice; the selected lookback moves from 1 year in
the early folds to 9 years later as the expanding window makes longer
histories available.

The baseline's own bias is now reported alongside its metrics. With fair
tuning the seasonal baseline improves (MAE 38.08 to 37.24 over the 96-fold
backtest) but remains **significantly worse than persistence** (delta
+15.83 ug/m3, p = 9.1e-87), with a residual bias of +3.75 ug/m3. So the
defect was real and is corrected, but the correction does not rescue the
baseline: a day-of-year climatology cannot predict day-to-day variability in
Delhi-NCR PM2.5.

---

## D-006 — The reported improvement over persistence is not statistically significant

| | |
|---|---|
| **Severity** | High |
| **Status** | VERIFIED |
| **Location** | `results/metrics.json` → `metrics.WeightedEnsemble_0.6RF_0.4XGB`, `baselines.Persistence_baseline` |
| **Evidence** | Paired Wilcoxon signed-rank test, n = 33 |

**Observed behaviour.** The ensemble reports MAE 17.298 against a persistence
baseline of 19.918 on the same 33 test days. A paired Wilcoxon signed-rank
test on the per-day absolute errors gives **p = 0.1495**, and a paired
bootstrap of the MAE difference gives a 95% confidence interval of
**[-6.47, +1.39]**, which spans zero.

**Impact.** The headline result — that the multisource model beats simple
persistence — is **not statistically supported** at the conventional 0.05
level. Presenting the MAE difference alone materially overstates the result.
The plan requires "fold-level results, paired comparisons and appropriate
uncertainty estimates" and states that one must not "claim statistically
significant improvement merely because one MAE is numerically smaller".

**Proposed correction.** Publish the paired test and bootstrap interval
alongside every headline metric. Do not describe the ensemble as beating
persistence until the interval excludes zero.

**Resolution applied (Phase 2).** `src/aerosphinx/evaluation/uncertainty.py`
provides `paired_wilcoxon` and `paired_bootstrap_ci` (paired on the day, with
a fixed seed for reproducibility), and `compare_models` produces a table
with an explicit `verdict` column. Every comparison in the Track A backtest
now carries a p-value, a bootstrap interval and a verdict, so a numerically
smaller MAE can no longer be mistaken for a demonstrated improvement.

The extended finding, from the 96-fold backtest over the full nine-year
record: **no learned model significantly beats persistence at one-day
horizon.** Random Forest matches it (delta -0.013, p = 0.86), ridge matches
it (delta +0.101, p = 0.52), and XGBoost is significantly worse (delta
+0.965, p = 0.018). The learned models *do* beat persistence in the
pre-monsoon and winter seasons, which is the physically expected pattern,
but the effect is not large enough to move the nine-year aggregate past
significance. See `docs/PHASE2_REPORT.md`.

---

## D-007 — The ensemble does not beat its own ground-only ablation

| | |
|---|---|
| **Severity** | High |
| **Status** | VERIFIED |
| **Location** | `results/metrics.json` → `baselines` |
| **Evidence** | Reproduced; all 81 numeric metrics reproduce exactly |

**Observed behaviour.** On the identical 33 test rows, the ablations give:

| Model | MAE | RMSE | R2 |
|---|---|---|---|
| `Ground_history_only` | **16.617** | 23.671 | -0.050 |
| `No_satellite_AOD` | 17.205 | 22.976 | 0.011 |
| `WeightedEnsemble` (full) | 17.298 | 22.902 | **0.017** |
| `Persistence_baseline` | 19.918 | 24.186 | -0.096 |
| `Satellite_AOD_only` | 19.260 | 24.355 | -0.112 |
| `Meteorology_only` | 20.119 | 26.811 | -0.347 |

The full multisource ensemble is **worse on MAE** than the ground-history-only
ablation, and the fused model has an R2 of **0.017** — essentially no
explanatory power. The satellite-only and meteorology-only models are both
worse than persistence.

**Impact.** There is currently **no evidence that satellite or meteorological
information adds predictive value**. The repository's central research
question — the entire justification for Track B — is not supported by its own
results. Any claim of multisource benefit would be a scientific overclaim.
Note also that the full ensemble's apparent advantage comes substantially from
the 0.4 persistence anchor: the unanchored ensemble has MAE 20.118, i.e.
worse than persistence.

**Proposed correction.** Report the full ablation table as the primary
Track B result, state plainly that fusion did not beat ground-only, and
treat the demonstration of incremental value as the open research question
rather than a settled result.

---

## D-008 — PBLH is unavailable and the configured fallback is wrong

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:124-125` (`MERRA_REQUESTED`, `MERRA_FALLBACKS`) |
| **Evidence** | `results/baseline/data_audit.json` → `merra2.requested_variables_missing_in_all_granules` |

**Observed behaviour.** The pipeline requests `PBLH` and declares
`MERRA_FALLBACKS = {"PBLH": ["PBLTOP"]}`. **Neither `PBLH` nor `PBLTOP` is
present in any of the 172 granules** — both are missing in all 172 files. The
pipeline therefore drops the feature and reports `PBLH` under
`features_unavailable`, which is the correct *outcome*.

**Impact.** The outcome is right but the mechanism is not. The plan explicitly
forbids "PBLTOP-to-PBLH substitution without established scientific
equivalence", and `PBLTOP` (pressure at top of boundary layer) is not a
substitute for `PBLH` (boundary layer height) in any case. The fallback is
dead code that would silently activate if a future granule happened to
contain `PBLTOP`, producing a physically invalid feature. The README
correctly documents the current absence, but the code carries a latent trap.

**Proposed correction.** Remove the `PBLTOP` fallback entirely. If boundary
layer height is required, it must be obtained by re-subsetting MERRA-2 with
`PBLH` included.

---

## D-009 — `Humidity_Ratio` is mis-named and mis-defined

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED |
| **Location** | `aerosphinx_pipeline.py:425`, `aerosphinx_pipeline.py:171-172` |
| **Evidence** | `results/baseline/data_audit.json` → `merra2.variable_metadata` |

**Observed behaviour.** The feature is defined as `QV2M / (T2M + EPS)` and
described as "Combined moisture-temperature aerosol growth term". MERRA-2
`QV2M` is 2-metre **specific humidity** (kg/kg, verified from the granule
attribute `units='kg kg-1'`, `long_name='2-meter_specific_humidity'`) and
`T2M` is 2-metre air temperature in K. Their ratio is not a humidity ratio
in any conventional sense.

**Impact.** The plan states plainly that "QV2M/T2M is not a conventional
humidity-ratio calculation" and requires the feature to be replaced. As
labelled, the feature invites a reader to mis-interpret it. Specific humidity
itself (`QV2M`) is already in the feature list, so the derived ratio adds a
weakly-motivated column with a misleading name.

**Proposed correction.** Rename to a physically accurate name (e.g.
`SpecificHumidityPerKelvin`), or drop it and retain `QV2M` directly. If a
hygroscopic-growth proxy is wanted, define it explicitly and justify the
form.

---

## D-010 — MERRA-2 granules contain 3 hourly steps per day, not a daily series

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED |
| **Location** | `data/merra2/*.SUB.nc` (granule metadata), `aerosphinx_pipeline.py:340-381` |
| **Evidence** | `results/baseline/data_audit.json` → `merra2.time_signatures_utc` |

**Observed behaviour.** The product is `tavg1_2d` (2-daily, 1-hourly
averaged), but the distributed granules were subsetted to **timestamps 12, 13
and 14 only** (11:30, 12:30 and 13:30 UTC), on a **1 x 1 grid** at
28.5 N, 77.5 E. The granule's own `history_L34RS` attribute records
`Spatial: 77.2 77.4 28.3 28.5. Timesteps: 12 13 14`. The pipeline averages
those three values and calls the result a daily mean.

**Impact.** Every MERRA-2 feature in the model is a **midday window mean from
a single grid cell**, not a daily mean over a collocation box. The code
docstring claims the values are "spatially averaged over the Faridabad
bounding box", which is not what the data supports. Consequences: the
features are not diurnally representative, the station-grid offset
(28.5, 77.5 versus 28.4089, 77.3178) is unquantified, and the temporal
sampling is biased toward the hours of peak boundary-layer mixing.

**Proposed correction.** Describe the features accurately as
midday-window single-cell values, or re-subset MERRA-2 with full 24-hour
coverage and a deliberate collocation box. Either way, correct the docstring
and the feature descriptions, and quantify the grid-point offset.

---

## D-011 — Feature importance is dominated by the month term

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED |
| **Location** | `results/feature_importance.csv` |
| **Evidence** | `month_sin` 37.93%, `month_cos` 6.29% |

**Observed behaviour.** `month_sin` carries **37.93%** of the ensemble's
normalised importance — roughly six times the next feature and more than the
three PM2.5 history features combined (11.22 + 6.19 + 5.85 = 23.26%).

**Impact.** The model is substantially a seasonal climatology with a
persistence anchor, not a physical model of aerosol processes. This is
consistent with the near-zero R2 and with the climatology baseline being
poorly specified (D-005): the model has learned "what does May look like"
rather than "what drives aerosol loading". The physical features (AOD, wind,
temperature) are being used as noise-fillers. Reporting this model as a
multisource environmental model would misrepresent it.

**Proposed correction.** Report importance with the seasonal terms separated
out, and test the hypothesis explicitly: fit a month-only model and compare
it against the full feature set on identical rows.

---

## D-012 — Duplicate CPCB source files across two repository locations

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED |
| **Location** | `data/City_wise_raw_data_1Hr_*.csv` (git) vs `ML model/CPCB Data/City_wise_raw_data_1Hr_*.csv` (git) |
| **Evidence** | Byte-identical SHA-256 for 2017-2023 (7 pairs) |

**Observed behaviour.** Seven CPCB files exist twice in the tracked history
at `data/` and at `ML model/CPCB Data/` with **identical SHA-256 digests**.
The current pipeline reads only `data/cpcb/`, so it is not double-counting
today, but the aggregation step in `load_cpcb_daily` sums `valid_hours`
across files and would silently double-count coverage if both directories
were ever passed in.

**Impact.** A latent double-counting hazard in the aggregation contract, and
wasted repository space. The plan explicitly requires a "duplicate-hour test"
and warns against "a mean of file-level daily means when files contain unequal
numbers of hourly readings".

**Proposed correction.** Deduplicate to a single canonical location, and add
an aggregation test that asserts no hour is counted twice across input files.

---

## D-013 — Mean-of-file-means aggregation is structurally unsafe

| | |
|---|---|
| **Severity** | Medium |
| **Status** | **FIXED (Phase 1)** |
| **Location** | `src/aerosphinx/ingestion/cpcb.py` → `aggregate_daily` |
| **Evidence** | `results/baseline/data_audit.json` → `cpcb.mean_of_means_vs_hour_weighted_mismatch_days` |

**Observed behaviour.** The loader aggregates each file to daily means
first, then averages those per-file daily means across files by date. This
is the exact pattern the plan warns against. On the **current** data it
produces **0 mismatching days out of 2979** against a true hour-weighted
daily mean (max absolute difference 1.1e-13), because each date appears in
exactly one file.

**Impact.** No numerical impact today, but the correctness of the daily series
depends on a property of the input layout (one file per year, no overlap)
rather than on the algorithm. Adding a single overlapping file — including
the duplicate files noted in D-012 — would silently change every affected
daily mean.

**Proposed correction.** Aggregate at the hourly level across all files, then
compute one daily mean per date. Keep the file-level provenance separately so
the aggregation remains auditable.

**Resolution applied (Phase 1).** `aggregate_daily` now pools every unique
hourly observation across all files and computes one hourly-weighted mean per
date. The result on the real record is **identical to the legacy output**
(max absolute difference 0.0 over all 2,979 days), confirming the correction
is behaviour-preserving on data whose files do not overlap — but it is now
correct by construction rather than by accident of file layout.

Proof tests: `tests/unit/test_cpcb_ingestion.py::test_daily_mean_is_hour_weighted_across_files`
(a 20/4 hour split that the mean-of-file-means would score 55.0 and the
hour-weighted mean scores 25.0) and
`::test_aggregation_is_independent_of_file_split`.

---

## D-014 — Legacy pipelines, notebooks and documentation are absent from the worktree

| | |
|---|---|
| **Severity** | Medium |
| **Status** | VERIFIED (recoverable from git history) |
| **Location** | 66 tracked paths deleted in the working tree |

**Observed behaviour.** The working tree deletes **407** tracked paths. 341
of them are byte-identical to files relocated under `data/`
(`data/aod`, `data/merra2`, `data/cpcb`). **66** exist nowhere on disk; of
those, 11 are exact duplicates of another tracked path and 55 are unique,
recoverable only from commit `859fd08`. The unique set includes every legacy
Python pipeline and notebook: `scripts/run_research_pipeline.py` (662 lines),
`ML model/ML_Model.py`, `ML_Model.py`, `pawanai-project/pawanai.py` (1106
lines), `Data_Reading.ipynb`, plus chapter drafts, `.pbix`/`.docx`/`.pptx`
artefacts and the original `results/audit_report.md`.

**Impact.** The plan's repository-preservation section requires that legacy
results and model artefacts be preserved, and states "do not delete, overwrite,
push or rewrite history without explicit permission". Committing the current
working tree as-is would remove these from the active tree. They remain
recoverable from history, but a `git checkout` of a future commit would make
them harder to find, and the audit trail between the legacy pipeline and the
current one would be lost.

**Proposed correction.** Before the restructuring is committed, restore the
legacy source artefacts into a `legacy/` directory as the plan's architecture
specifies, so the experimental history remains inspectable. The 341 relocated
data files should be committed as renames, which git detects automatically.

**Resolution applied (Phase 0).** The 50 genuinely unique artefacts were
recovered from `859fd08` and restored under `legacy/`, preserving their
original relative paths, and verified byte-identical to the baseline blobs.
The 341 relocated data files are committed as renames (399 renames detected).
A final integrity check confirms **0 content loss** across all 407 removed
HEAD paths. `legacy/README.md` documents the provenance and the rules
governing the directory.

---

## D-015 — CRLF line-ending conversion in the relocated CPCB files

| | |
|---|---|
| **Severity** | Low |
| **Status** | VERIFIED |
| **Location** | `data/cpcb/*.csv` vs git `data/City_wise_raw_data_1Hr_*.csv` |

**Observed behaviour.** The nine relocated CPCB files use CRLF line endings
while the tracked originals use LF. After normalising CRLF to LF the two sets
are **byte-identical for all nine files**, confirming no data alteration.

**Impact.** None on parsing — pandas handles both. It does mean the raw
digests differ from the historical ones, which matters for manifest
provenance. The Phase 0 manifest records the current digests precisely so
this is traceable.

**Proposed correction.** None required. Note the convention in the data
dictionary so future hash comparisons are not misread as data changes.

---

## D-016 — Operational forward forecast extrapolates an upward drift

| | |
|---|---|
| **Severity** | Low |
| **Status** | VERIFIED |
| **Location** | `results/operational_forward_forecast.csv` |
| **Evidence** | 96.6 -> 112.3 -> 122.2 -> 129.6 -> 138.5 ug/m3 |

**Observed behaviour.** The forward forecast rises monotonically across all
five days, ending at 138.5 ug/m3 ("Very Poor"). The driver is the recursion:
each prediction re-enters the model as `PM25_Lag_1` and, with the 0.4
persistence anchor, compounds the error in one direction.

**Impact.** The persistence anchor, selected on the validation window, is
applied unchanged at every horizon of a five-day recursion, where its
optimal value would very likely differ. The result is presented as an
operational outlook, and the anchor was tuned for a **one-step** horizon.

**Proposed correction.** Treat the anchor as a per-horizon parameter, or
disable it for horizons beyond one. Label the output clearly as a
persistence-dominated projection, not a forecast, until real future
covariates are available.

---

## Open questions requiring a decision (BLOCKED)

| ID | Question | Why it is blocked |
|---|---|---|
| B-001 | Is a boundary-layer-height product obtainable for 2024? | Requires a MERRA-2 re-subset with `PBLH`; needs network access and a data request. |
| B-002 | Can INSAT-3D granules for 2016-2023 be obtained? | Without them the fused dataset stays confined to 2024 and Track B cannot be evaluated on the full CPCB record. |
| B-003 | Are the 27 zero-pixel AOD granules retrievable at higher temporal resolution, or are they genuinely cloud-flagged? | The distributed granules contain no QA or cloud-flag dataset, so this cannot be determined from local files. |
| B-004 | Should the chapter draft, `.pbix` and `.docx` artefacts be retained in the repository? | These are deliverables, not research inputs; retention is a project decision. |
| B-005 | Is the `.pbix`/PowerBI work part of the research record or an application artefact to be isolated? | Affects whether it belongs in `legacy/` or in a separate application area, per the plan's `pawanai-project` guidance. |
| B-006 | What is the intended definition of "availability-aware" fallback behaviour? | The plan describes it conceptually but does not specify the fallback policy, so implementation would be speculative. |
| B-007 | What is the provenance of the root-level legacy CSV files (`aod_data_1..3.csv`, `combined_pm2.5_para*.csv`, `pm25_cpcb_05AM_*.csv`, `predicted_pm25_jan_to_dec_2019.csv`)? | The plan requires determining their provenance before moving or deleting them. They are preserved under `legacy/` unmodified so the question can be answered later from the data itself; answering it needs upstream context that is not in the repository. |
| B-008 | Should the 124 Track A rows without a complete 1-day lag be dropped, or handled with gap-skipping lags? | Changes the usable Track A dataset size by roughly 4%. Phase 2 must choose and report the choice. |
| B-009 | Should a day carrying a duplicated hour be excluded entirely, or resolved by a documented precedence rule? | No effect on the current record (no duplicate hours exist). Matters only if overlapping CPCB files are ever supplied. The current policy excludes the day. |
| B-010 | Can the provenance and QA conventions of the CPCB export itself be established, particularly for the station-local meteorological columns? | Blocks the decision to use `AT`, `RH`, `WS`, `WD`, `RF`, `SR`, `BP` and `VWS` as Track A features, which are available across the full 2016-2024 record at ~99% completeness. Now higher priority: Track A shows ground history alone saturates at one-day horizon, so these are the most promising remaining source of signal. |
| B-011 | Should the cold-start folds (2017) be reported as a headline result, or excluded as an unrepresentative warm-up? | Currently reported in full, with the mechanism quantified. Excluding them would flatter the learned models, so the honest default is to keep them. |
| B-012 | Is a regime-conditional model - persistence in monsoon, a learned model otherwise - in scope? | The per-season table suggests it would beat either model alone, and it is the natural home for the availability-aware framework the plan proposes. |
