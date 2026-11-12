# AGENTS.md — AeroSphinx Integrated Research Engineering Contract

This file is the primary project instruction for any agent or engineer working
on AeroSphinx. It governs the repository at
<https://github.com/AkshatGo/AeroSphinx>.

**Current phase: 3 in progress — Workstreams A, B and D complete;
Workstream C (regime-conditional modelling) not started.**
See `docs/PHASE3_PROTOCOL.md` (protocol and acceptance criteria),
`docs/PHASE3_AUDIT.md` (audit of the Phase 2 evaluation and its two
defects), and `docs/PHASE3_WORKSTREAM_{A,B,D}.md` for the completed
workstreams.

---

## 1. Role

Act as the principal scientific software engineer, ML engineer, data engineer
and independent research auditor.

You are modifying the **existing** AeroSphinx repository. Do not create an
unrelated replacement project.

Your objective is to build one reproducible research platform containing two
independently evaluated research tracks.

## 2. Research objective

AeroSphinx studies PM2.5 estimation and forecasting using:

- CPCB ground observations
- INSAT AOD satellite observations
- NASA MERRA-2 meteorological observations

**Track A** — historical CPCB-based PM2.5 forecasting.

**Track B** — multisource PM2.5 estimation using CPCB, INSAT AOD and MERRA-2,
with forecasting only when future covariates are genuinely available.

Shared infrastructure is allowed. Shared experimental assumptions are **not**
automatically allowed.

## 3. Evidence rules

Classify every finding as:

- **VERIFIED** — directly supported by inspected evidence.
- **INFERRED** — logically derived but not directly verified.
- **UNKNOWN** — insufficient evidence.
- **BLOCKED** — requires missing data, permission or clarification.

Never invent: dataset records, data provenance, physical units, product
metadata, scientific citations, performance metrics, experimental outcomes, or
model improvements.

Every defect must include: file path, line number or function, observed
behaviour, scientific or engineering impact, proposed correction, and a test
proving the correction.

## 4. Track separation

**Track A**

- CPCB daily time series
- Persistence baseline
- Seasonal naive baseline
- Regularized regression
- Random Forest
- XGBoost
- Direct multi-horizon forecasting
- Recursive forecasting
- Rolling-origin backtesting

**Track B**

- Ground-only benchmark
- AOD-only experiment
- Meteorology-only experiment
- CPCB + AOD
- CPCB + meteorology
- CPCB + AOD + meteorology
- Missing-source robustness
- Feature and coverage analysis

Do not combine scores from different test windows. When comparing models, use
identical evaluation dates and identical target observations.

## 5. Scientific integrity

All features must obey an explicit availability contract.

- Retrospective MERRA-2 reanalysis is not automatically a valid operational
  future forecast feature.
- Future observed AOD and future observed meteorology must never enter an
  operational forecast.
- No unrestricted forward filling.
- No invented satellite observations.
- No PBLTOP-to-PBLH substitution without established scientific equivalence.
- No row-based PM2.5 lags where calendar gaps exist.
- No tuning on held-out test data.
- Separate concentration category estimates from official multi-pollutant AQI
  claims.

## 6. Implementation order

- **Phase 0** — Repository audit and baseline preservation. *(complete)*
- **Phase 1** — CPCB ingestion. *(complete)*
- **Phase 2** — Track A feature engineering and baselines. *(complete)*
- **Phase 3** — Track A forecasting and backtesting.
  - **Phase 3 audit** — the Phase 2 evaluation audit and its two corrections. *(complete)*
  - **Workstream A** — multi-horizon forecasting, days 1–5. *(complete)*
  - **Workstream B** — cold-start and extrapolation diagnostics. *(complete)*
  - **Workstream C** — regime-conditional modelling. *(not started)*
  - **Workstream D** — CPCB station-local meteorology audit. *(complete)*
- **Phase 4** — INSAT AOD validation.
- **Phase 5** — MERRA-2 validation.
- **Phase 6** — Multisource fusion and availability.
- **Phase 7** — Track B ablations and robustness.
- **Phase 8** — Operational covariate availability and forecasting.
- **Phase 9** — CI, reproducibility and research reporting.

**Never skip an acceptance gate.**

### Phase 3 findings that bind later phases

1. **The horizon-appropriate baseline changes the conclusion.** Against the
   day-1 baseline the learned models look worse with horizon; against the
   correct day-*h* baseline they are **better from day 2 onward**. Any
   future forecast evaluation must use the horizon-appropriate persistence
   value as its reference. (D-019, FIXED)

2. **The naive bootstrap overstated the evidence.** Block-aware inference
   and Holm correction change at least one published conclusion.
   (D-018, FIXED)

3. **Cold start is a coverage failure, not a bounding failure.** Tree
   ensembles never predict outside their training range; they predict
   *inside* it and are up to +71 µg/m³ too high. Range-based fallbacks do
   not detect it (they fire 0 times); a regime-aware fallback does.
   (Workstream B)

4. **Station-local meteorology is genuine but not yet usable.** The nine
   CPCB meteorological columns are confirmed hourly station-local
   measurements (zero identical values against MERRA-2 in 516 matched
   hours), but **no availability timestamp can be established**, so none is
   forecast-usable. (Workstream D)

5. **The project question has shifted.** Ground history alone beats
   persistence from h=2, so an environmental feature group must add value
   *on top of* an already-strong ground-history model — not merely lift a
   day-1 model to parity with persistence.

### Phase 2 output (complete)

| Artefact | Path |
|---|---|
| Metrics (incl. AQI category) | `src/aerosphinx/evaluation/metrics.py` |
| Rolling-origin splits | `src/aerosphinx/evaluation/splits.py` |
| Paired uncertainty | `src/aerosphinx/evaluation/uncertainty.py` |
| Baselines | `src/aerosphinx/models/baselines.py` |
| Supervised models | `src/aerosphinx/models/supervised.py` |
| Regime diagnostics | `src/aerosphinx/tracks/diagnostics.py` |
| Track A runner | `src/aerosphinx/tracks/track_a.py` |
| CLI | `scripts/run_track_a.py` |
| Results | `results/runs/<run_id>/` |
| Tests | 86 total across `tests/unit/` and `tests/integration/` |

**Phase 2 headline: no learned model significantly beats persistence at
one-day horizon over the full nine-year record.** Random Forest matches it
(delta -0.013, p = 0.86). The learned models *do* beat persistence in
pre-monsoon and winter. See `docs/PHASE2_REPORT.md`.

### Phase 1 output (complete)

| Artefact | Path |
|---|---|
| CPCB ingestion | `src/aerosphinx/ingestion/cpcb.py` |
| Calendar-aware temporal features | `src/aerosphinx/features/lags.py` |
| Coverage and provenance | `src/aerosphinx/quality/` |
| Track A dataset builder | `scripts/build_track_a_dataset.py` |
| Validated daily series | `data/processed/track_a_daily.csv` |
| Daily series with features | `data/processed/track_a_features.csv` |
| Run manifest | `data/manifests/track_a_ingestion.json` |
| Tests | `tests/unit/`, `tests/integration/` (40 tests) |

The legacy `aerosphinx_pipeline.py` is retained unchanged as the Phase 0
baseline and compatibility entry point. It is **not** the research package;
Phase 2 onward work in `src/aerosphinx/`.

## 7. Repository preservation

Before modification:

- Record Git SHA and branch.
- Record working-tree status.
- Inventory source, notebooks and datasets.
- Hash important raw files.
- Preserve legacy results and model artefacts.

**Do not delete, overwrite, push or rewrite history without explicit
permission.**

Do not deserialize untrusted model artefacts before reviewing their
provenance.

## 8. Required tests

**CPCB** — duplicate-hour test; unequal-file-size aggregation test; timestamp
and missing-hour tests.

**INSAT** — HDF5 dimension and orientation tests; fill-value and QA tests;
spatial-window tests; duplicate-granule tests.

**MERRA** — dimension and timestamp tests; unit validation; grid extraction
tests; variable aggregation tests.

**Features** — calendar-aware lag tests; rolling-window leakage tests;
missing-source tests.

**Evaluation** — chronological split tests; test-set isolation tests;
matched-date comparison tests; rolling-origin tests.

**Forecasting** — issue-time availability tests; future-observation leakage
tests; recursive prediction propagation tests; missing-covariate fallback
tests.

## 9. Required documentation

- `docs/REPOSITORY_AUDIT.md`
- `docs/DEFECT_REGISTER.md`
- `docs/DATA_DICTIONARY.md`
- `docs/SCIENTIFIC_ASSUMPTIONS.md`
- `docs/EXPERIMENT_PROTOCOL.md`
- `docs/LIMITATIONS.md`
- `docs/RESEARCH_FINDINGS.md`

Every experiment must save a manifest containing: Git SHA; environment and
package versions; input hashes; dataset counts and date range; feature list;
source availability rules; split boundaries; model configuration; random seed;
metrics; and prediction artifact locations.

## 10. Agent execution protocol

Work on one phase at a time.

**Before coding:** explain the problem, evidence, impact and intended
correction.

**During coding:** make the smallest safe change. Add tests. Preserve old
outputs.

**After coding:** run tests. Report exact commands and results. Compare
before/after dataset counts. List remaining risks.

Use **PASS**, **FAIL** or **NOT RUN**. Never report an unexecuted test as
passed.

If a critical scientific assumption is unknown, **STOP** and ask for evidence
or approval.

## 11. Phase 0 findings that bind later phases

These are VERIFIED and constrain the design of every later phase.

1. **D-002 (Critical). — OPEN, Phase 8.** The shipped five-day "forecast"
   consumes future observed AOD and MERRA-2 values. It is a retrospective
   estimation, not an operational forecast. Any forecast interface must carry
   an explicit issue timestamp and enforce an availability contract.

2. **D-001 (Critical) — FIXED in Phase 1.** PM2.5 lags are now calendar-aware.
   `src/aerosphinx/features/lags.py` reindexes onto the full calendar before
   shifting, so 123 rows that previously carried a stale value (worst case 25
   days old) now carry `NaN`. **Do not reintroduce row-based `shift()`.**

3. **D-007 (High).** The fused ensemble does **not** beat the ground-only
   ablation (MAE 17.298 vs 16.617) and has R2 = 0.017. There is currently no
   evidence that multisource information adds value. Track B must be framed as
   an open experiment, not a demonstration.

4. **D-006 (High) — ADDRESSED in Phase 2.** Every comparison now carries a
   paired test, a bootstrap interval and an explicit verdict. The extended
   finding: on the full nine-year record, **no learned model significantly
   beats persistence** at one-day horizon (RF matches it, delta -0.013,
   p = 0.86). **Do not claim a model beats persistence without an interval
   that excludes zero.**

5. **D-003 (High).** Forward-filling silently manufactures environmental
   observations (7 AOD rows, 1 MERRA-2 row in the shipped frame). Phase 6 must
   replace filling with an explicit availability mask.

6. **D-010 (Medium).** MERRA-2 features are midday single-cell values, not
   daily means over a collocation box. Documentation and feature naming must
   be corrected before any MERRA-based claim is made.

7. **D-014 (Medium) — RESOLVED in Phase 0.** Legacy pipelines and notebooks
   were absent from the working tree and recoverable only from commit
   `859fd08`. The 50 unique artefacts have been restored under `legacy/`,
   verified byte-identical, with 0 content loss across all 407 removed HEAD
   paths. Do not re-delete them.

8. **Data heterogeneity.** The CPCB record changes character between 2016 and
   2023 (integer-valued readings fall from 96.1% to 0.3%). Any Track A model
   spanning the full record must account for this. **Phase 3 must test for
   distribution shift** before interpreting the year-on-year MAE trend.

9. **Track A has 18x more data available than the fused frame.** CPCB spans
   9 years and 2,979 accepted daily days; the fused frame is 166 rows over
   six months of one year. Track A is the stronger foundation and should be
   built first.

10. **Cold-start asymmetry (Phase 2).** Tree ensembles cannot predict
    outside their training target range; persistence can. On the 8 of 96
    folds that require extrapolation, Random Forest is +17.11 ug/m3 worse
    than persistence and XGBoost +25.25. This is a property of the problem,
    not a bug, and it must be reported wherever tree models are evaluated.

---

## 12. Phase gates

- **Phase 0** — no source edits before the audit is approved.
- **Phase 1–3** — Track A must beat no baseline by assumption; its results
  must be honestly reported, even if it does not.
- **Phase 4–6** — multisource datasets must pass quality and alignment tests
  before fusion.
- **Phase 7** — fusion must demonstrate measurable improvement on matched
  observations to support an improvement claim.
- **Phase 8** — operational forecasts require real future covariate
  availability.
- **Phase 9** — every headline result must be reproducible from a clean
  environment.
