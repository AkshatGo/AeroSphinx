# AeroSphinx — availability-aware multisource PM2.5 research platform

> **A Multi-Source Machine Learning Framework for Satellite-Fused PM2.5 Estimation
> and Five-Day Atmospheric Forecasting over Urban India**
> Raju Bhakta and Indraneel Chatterjee
> Mathematics and Basic Sciences, NIIT University, NH-8, Delhi–Jaipur Highway,
> Alwar, Neemrana, Rajasthan-301705, India

AeroSphinx is being rebuilt as **two independently evaluated research tracks**
over a shared, evidence-first infrastructure:

| Track | Question | Data |
|---|---|---|
| **A** | How far can historical ground measurements alone predict future PM2.5? | CPCB, 2016–2024 (2,979 daily days) |
| **B** | Does satellite and meteorological information actually add value? | CPCB + INSAT-3D AOD + MERRA-2 |

The current scientific position, established by the Phase 0 audit, is
documented in `docs/RESEARCH_FINDINGS.md`. In short: the shipped baseline
reproduces exactly (81/81 metrics) but **does not** demonstrate that fusion
beats ground-only prediction, and its five-day "forecast" is a retrospective
estimation rather than an operational forecast. Those are the open questions
the two tracks exist to answer.

> **Start here:** `AGENTS.md` (engineering contract) · `docs/REPOSITORY_AUDIT.md`
> (audit) · `docs/DEFECT_REGISTER.md` (defects) · `docs/PHASE7_REPORT.md`
> (matrix and its negative result) · `docs/FEATURE_AVAILABILITY_CONTRACT.md`
> (per-feature availability) · `docs/EXPERIMENT_PROTOCOL.md` (how experiments
> must be run).

---

## Quick start

```bash
make install-dev          # install the package and test dependencies
make test                 # 253 Python tests
make build-track-a        # build the Track A daily dataset and manifest
make run-track-a          # run the Track A rolling-origin backtest
make run-phase6           # build the fused dataset and run the availability gate
make run-matrix           # run the M0-M8 matrix on identical eligible dates
make run-sufficiency      # per-season source sufficiency
make run-alignment        # daily coverage, missingness and alignment report
make check-deploy         # deployed commit == local HEAD
make check-claims         # README numbers vs persisted artefacts
```

Runtime is roughly two to four minutes on a standard laptop CPU. No GPU and no
network access are required; all input files are local.

### Current scientific position

Every number below is reproducible from the persisted artefacts:
`aerosphinx check-claims` re-derives each one from `results/` and fails if the
prose and the artefacts disagree. `results/CANONICAL.json` is the registry it
checks against.

The canonical Track A result is the M0–M8 matrix: 97 rolling-origin folds over
the full nine-year record, with 2,615 matched predictions for every
configuration. Ridge on ground history plus calendar reaches **21.44 MAE
against persistence's 22.09**, a delta of -0.65 whose day-level block bootstrap
interval [-1.14, -0.17] excludes zero. Resampling whole calendar years instead
of days widens it to [-1.20, +0.06], which does not. The honest reading is
therefore narrow: a gain of about 3% of the observed MAE, which holds in
winter, pre-monsoon and post-monsoon, reverses in monsoon, and is not robust to
which years happen to be in the record. It is not a general improvement in
day-ahead skill.

That matrix figure is the published Track A comparison. `scripts/run-track-a`
is a protocol-discovery tool with a narrower eligible set (2,510 predictions,
because it requires a complete seven-day warm-up) and its ridge delta has the
opposite sign (+0.34, p = 0.13); it is a diagnostic, not the result. The
pre-audit Phase 2 numbers are marked superseded in `docs/PHASE2_REPORT.md`.

Phase 6 publishes the fused Track B dataset with an explicit availability
mask: all 2,979 ground rows are preserved, missing environmental values are
never filled, and all three sources are observed together on only 139 rows
(4.7%).

Phase 7 runs the M0–M8 ladder on identical eligible dates within each track.
On Track B's 80 fused dates persistence scores 22.98 and the ground-only ridge
28.59, but on the 49 dates where every configuration predicts the two are
indistinguishable (-0.25, interval [-5.66, +5.11]); the 5.6 MAE gap is
concentrated in the 31 dates outside that common set, which is exactly the
informative-missingness structure the protocol exists to expose. On those 49
dates adding AOD changes MAE by +0.21 [-2.19, +2.61], MERRA-2 by +4.24
[+1.26, +7.18] (Holm-adjusted p = 0.06) and full fusion by +4.70
[+0.30, +10.41] (Holm-adjusted p = 0.34). **No environmental ablation is
distinguishable from zero.** The result is negative and underpowered, and is
now reported as both: not "fusion costs 4.70 MAE" but "nothing here separates
fusion from the ground-only model on 49 days".

Full analysis: `docs/PHASE2_REPORT.md` (Track A), `docs/PHASE6_REPORT.md`
(fusion and availability), `docs/PHASE7_REPORT.md` (matrix, ablations,
sufficiency), `docs/FEATURE_AVAILABILITY_CONTRACT.md` (per-feature contract).

### Web application

`api/server.py` serves 13 read-only routes over the persisted artefacts, and
the Vite frontend in `ui/` renders them in ten modules. Nothing is fabricated:
an unavailable artefact produces an explicit empty state. The forecast endpoint
abstains rather than inventing a value.

```bash
python api/server.py            # API + built frontend on :8787 (or $PORT)
cd ui && npm ci && npm run dev  # frontend dev server on :5173
make check-deploy               # verify the deployment matches local HEAD
```

### Legacy chapter pipeline

The single-script pipeline that produced the book chapter's tables, figures
and metrics is retained unchanged as the reproducibility baseline:

```bash
python -m pip install -r requirements.txt
python aerosphinx_pipeline.py
```

Optional arguments:

```bash
python aerosphinx_pipeline.py --config chapter   # literal Section 3 formulation
python aerosphinx_pipeline.py --select           # validation configuration search
python aerosphinx_pipeline.py --forecast-days 10 # longer operational forecast
python aerosphinx_pipeline.py \
    --cpcb-dir data/cpcb --aod-dir data/aod --merra-dir data/merra2 \
    --test-start 2024-05-17 --test-end 2024-06-18 --min-hours 18
```

## Two reproducible configurations (legacy chapter pipeline)

These belong to the legacy single-script pipeline, not to the Tracks. Its test
window is **33 days** (2024-05-17 to 2024-06-18) and its training window 130
days; a 33-day window cannot characterise seasonal behaviour, which is
assumption F3 in `docs/SCIENTIFIC_ASSUMPTIONS.md`. The numbers are here because
the chapter reports them, and they are labelled so they are not mistaken for
the Track A result above.

| | `tuned` (default) | `chapter` |
|---|---|---|
| Target | `log1p(PM2.5)`, inverted for reporting | raw concentration |
| Features | base set + `PM25_Roll3`, `PM25_Roll7` | base set |
| Output | `0.6 · y_model + 0.4 · y_(t-1)` | `y_model` |
| Test days (n) | 33 | 33 |
| Test MAE / RMSE / R² | **17.24 / 22.81 / +0.025** | 23.29 / 30.28 / −0.718 |

The `chapter` configuration is the literal Section 3 and Section 5 formulation.
The `tuned` configuration adds three documented choices, each selected on a
validation window (10 April to 16 May 2024, **37 days**) that closes before the
test window opens, so the test set influenced no modelling decision. Note that
37 autocorrelated days choosing among 36 candidate configurations is a weak
selection signal: the spread across the whole validation grid is ~0.35 MAE
(21.92 to 22.27) while the test-window difference between configurations is
6 MAE, so the choice is close to arbitrary and should not be read as tuning.
`--select` regenerates the search and writes the full table to
`results/configuration_selection.csv`.

Model hyperparameters are fixed as published in Section 5 in both cases and are
never searched.

## Repository layout

```text
AGENTS.md                  Research-engineering contract (read this first)
config/                    Every scientific rule, in a file rather than in code
  common.yaml              Paths, station, calendar conventions
  data_quality.yaml        Quality rules applied during ingestion
  track_a.yaml             Track A features, evaluation and baselines
  fusion.yaml              Availability policy for the fused Track B dataset
src/aerosphinx/            The research package
  ingestion/cpcb.py        Validated CPCB daily series with a full audit trail
  features/lags.py         Calendar-aware lags and rolling statistics
  features/availability.py Availability-masked multisource fusion and gate
  evaluation/              Splits, metrics, paired uncertainty quantification
  models/                  Baselines and supervised regressors
  features/seasonal.py     Single season and season-year definition
  tracks/                  Track A runner, regime diagnostics, M0-M8 matrix
  evaluation/sufficiency.py Per-season x source SUFFICIENT/INSUFFICIENT status
  quality/                 Coverage analysis, alignment and run provenance
data/cpcb/                 CPCB hourly PM2.5 exports, Faridabad, 2016-2024
data/aod/                  INSAT-3D Imager L2G AOD V02R00 granules (HDF5)
data/merra2/               MERRA-2 tavg1_2d_slv_Nx granules (NetCDF)
data/processed/            Derived datasets (Track A series + fused Track B frame)
data/manifests/            Run manifests with Git SHA, env and input hashes
results/runs/              Experiment runs: metrics, predictions, comparisons
scripts/                   Audit, dataset-build and experiment entry points
tests/                     Unit and integration tests
docs/                      Audit, defect register, data dictionary, protocol
legacy/                    Preserved pre-Phase-0 experimental record
results/ figures/ models/  Chapter outputs (legacy pipeline)
aerosphinx_pipeline.py     Legacy single-script chapter pipeline (unchanged)
```

## What the script does

The four layers of Section 4 map one-to-one onto functions in the script.

| Layer | Section 4 name | Functions |
|---|---|---|
| 1 | Data Acquisition | `load_cpcb_daily`, `load_aod_daily`, `load_merra_daily` |
| 2 | Harmonisation | `harmonise`, `engineer_features` |
| 3 | Modelling | `chronological_split`, `fit_ensemble`, `ensemble_predict`, `evaluate` |
| 4 | Forecasting | `recursive_forecast` |

Methodological choices, all matching the chapter text:

* PM2.5 values outside `[0, 500]` µg/m³ are treated as missing; a daily mean is
  kept only when at least 18 valid hourly samples are present.
* INSAT-3D AOD is collocated to the station by a ±0.25° window; fill values
  (−999) and impossible retrievals are removed before daily averaging.
* MERRA-2 fields are averaged over the Faridabad bounding box of each granule.
* Remaining gaps are forward-filled within a three-day window; anything still
  missing is excluded rather than imputed.
* Calendar variables use cyclic encodings, `day_sin = sin(2πd/7)` over the week
  and `month_sin = sin(2πm/12)` over the year, with matching cosine terms.
* Lags use only prior days, and the split is chronological, so no future
  information reaches the model.
* The ensemble is `0.6 · RF + 0.4 · XGB`, clipped to `[0, 500]` µg/m³.
* Hyperparameters are fixed as stated in Section 5 and are not searched.
* The five-day forecast is genuinely recursive: from day two onward the lag and
  rolling inputs are previous predictions, never observations.

## Forecasting, in two modes

`recursive_forecast()` — **evaluated mode**. The forecast is issued inside the
held-out window, so all five forecast days are days the model has never seen and
observations exist for scoring. Meteorological inputs are taken as given, which
matches the chapter's assumption that forward meteorology arrives from an
external forecast product. This is what Table 4 and Figure 7 report.

`forward_forecast()` — **operational mode**. The forecast runs past the last
observation, so no observed PM2.5 exists for any forecast day and every lag and
rolling input is a previous prediction. Meteorological and satellite inputs are
persisted from the most recent observed day, as a placeholder for the NWP fields
(NCMRWF, ECMWF-IFS, GFS) that Sections 8 and 9 identify as the requirement for
genuine prospective forecasting. Each row records `meteorology_source` so the
output is never mistaken for a real weather-forecast-driven product. Written to
`results/operational_forward_forecast.csv`; horizon set by `--forecast-days`.

Running both is deliberate: the difference between them isolates the cost of
recursive lag substitution from the cost of imperfect meteorology.

## Generated outputs

| File | Contents |
|---|---|
| `results/chapter_tables.md` | Tables 1, 2, 3, 3b and 4, ready to paste |
| `results/metrics.json` | Full machine-readable audit of the run |
| `results/test_predictions.csv` | Per-day observed, RF, XGB, ensemble, residual |
| `results/five_day_recursive_forecast.csv` | Evaluated forecast by horizon day |
| `results/operational_forward_forecast.csv` | Forward forecast beyond last observation |
| `results/configuration_selection.csv` | Validation search (`--select` only) |
| `results/feature_importance.csv` | Ensemble, RF and XGB importances |
| `results/daily_multisource_dataset.csv` | Full harmonised daily dataset |
| `results/modelling_dataset_complete_cases.csv` | Rows actually used for modelling |
| `figures/fig3_monthly_pm25_climatology.png` | Figure 3 |
| `figures/fig4_observed_vs_predicted.png` | Figure 4 |
| `figures/fig5_residuals.png` | Figure 5 |
| `figures/fig6_feature_importance.png` | Figure 6 |
| `figures/fig7_five_day_forecast.png` | Figure 7 |

## Data provenance and known constraints

| Stream | Provider | Local coverage |
|---|---|---|
| PM2.5 | CPCB National Air Quality Monitoring Programme | 2016-01-01 to 2024-12-31, hourly |
| AOD 550 nm | ISRO / SAC, INSAT-3D Imager L2G V02R00 | 2024-01-01 to 2024-06-18 |
| Meteorology | NASA GMAO, MERRA-2 `tavg1_2d_slv_Nx` | 2024-01-01 to 2024-06-20 |

Two constraints follow directly from these files and are reported by the script
rather than worked around:

1. **The multi-source model is a 2024 model.** A modelling row needs CPCB, AOD
   and MERRA-2 on the same day. The satellite and reanalysis granules held
   locally cover January to June 2024 only, so although the CPCB record reaches
   back to 2016, the fused dataset is confined to 2024. Extending the study to
   earlier years requires downloading the corresponding AOD and MERRA-2
   granules; the script picks them up automatically once they are in `data/`.

2. **PBLH is unavailable.** Planetary boundary layer height appears in the
   theoretical formulation of Section 3, but the subsetted MERRA-2 granules
   distributed with this study contain neither `PBLH` nor `PBLTOP`. The script
   detects this, drops the feature, and records it in `metrics.json` under
   `features_unavailable` instead of substituting a proxy. Re-subsetting
   MERRA-2 with `PBLH` included is the single highest-value data improvement
   available to this framework.

## Reproducibility

`random_state=42` throughout, fixed hyperparameters, no automated search, and a
chronological split, so repeated runs on the same files give identical numbers.
The exact configuration of each run is written to `results/metrics.json`.

## Acknowledgements

INSAT-3D Imager AOD products: Indian Space Research Organisation (ISRO), Space
Applications Centre (SAC), Ahmedabad. MERRA-2 reanalysis: NASA Global Modeling
and Assimilation Office (GMAO). Ground-level air-quality observations: Central
Pollution Control Board (CPCB), Government of India.
