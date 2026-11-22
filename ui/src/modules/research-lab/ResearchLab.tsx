import { useState } from "react";
import {
  useExperiments,
  useExperimentMatrix,
  useSeasonalSufficiency,
} from "@/lib/queries";
import type { ArtifactRow } from "@/lib/api";
import { EXPERIMENT_CATALOG, type ExperimentDef } from "@/lib/reference";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Metric,
  PageHeader,
  StatusBadge,
  formatNumber,
} from "@/components/ui/primitives";

function cell(row: ArtifactRow, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "—" : String(value);
}

function numeric(row: ArtifactRow, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

export function ResearchLab() {
  const [track, setTrack] = useState<"A" | "B">("A");
  const [selected, setSelected] = useState<string>("A2");
  const experiments = useExperiments();
  const matrix = useExperimentMatrix();
  const sufficiency = useSeasonalSufficiency();
  const mx = matrix.data;
  const sf = sufficiency.data;
  const defs = EXPERIMENT_CATALOG.filter((d) => d.track === track);
  const current: ExperimentDef | undefined =
    EXPERIMENT_CATALOG.find((d) => d.id === selected) ?? defs[0];

  function switchTrack(next: "A" | "B") {
    setTrack(next);
    setSelected(next === "A" ? "A2" : "B5");
  }

  const m = experiments.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Lab"
        tagline="Track A and Track B experiments with the metrics actually produced by the Python package."
      />

      <div className="inline-flex rounded-lg border border-line bg-surface p-1">
        {(["A", "B"] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchTrack(t)}
            aria-pressed={track === t}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              track === t
                ? "bg-accent text-surface"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            Track {t}
          </button>
        ))}
      </div>

      <p className="text-xs text-fg-muted">
        {track === "A"
          ? "Track A uses CPCB ground history only. Comparisons below are one-day-horizon metrics on the shared chronological holdout."
          : "Track B is retrospective estimation on matched dates. It may not be described as operational forecasting."}
      </p>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-1.5">
          {defs.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(d.id)}
              aria-pressed={selected === d.id}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selected === d.id
                  ? "border-accent/50 bg-accent/10"
                  : "border-line bg-surface hover:bg-surface-raised"
              }`}
            >
              <span className="font-mono text-[11px] text-fg-muted">{d.id}</span>
              <span className="ml-2 font-medium">{d.name}</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                {d.question}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <Card
            title={current ? `${current.id} · ${current.name}` : "Select an experiment"}
            description={current?.question}
            actions={
              current ? (
                <StatusBadge
                  status={current.mode === "retrospective" ? "WARNING" : "PASS"}
                  label={current.mode}
                />
              ) : undefined
            }
          >
            {current && (
              <>
                <p className="mb-3 text-xs text-fg-muted">
                  <span className="font-medium text-fg">Inputs:</span>{" "}
                  {current.inputs.join(", ")}
                </p>
                <p className="text-xs text-fg-muted">
                  Metrics for this experiment are read from{" "}
                  <code className="text-fg">results/metrics.json</code>. If a
                  model was not fitted for this configuration, it is shown as
                  unavailable rather than estimated.
                </p>
              </>
            )}
          </Card>

          <Card
            title="Model comparison"
            description="One-day horizon · identical 33-row holdout (2024-05-17 → 2024-06-18)"
          >
            {experiments.isLoading && <LoadingBlock rows={4} />}
            {experiments.isError && (
              <ErrorState
                message={(experiments.error as Error).message}
                onRetry={() => experiments.refetch()}
              />
            )}
            {m && !m.available && (
              <EmptyState
                title="Metrics unavailable"
                description={m.reason ?? "results/metrics.json not found"}
              />
            )}
            {m?.available && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-0">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-muted">
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">MAE</th>
                      <th className="py-2 pr-3">RMSE</th>
                      <th className="py-2 pr-3">R²</th>
                      <th className="py-2">Bias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(m.metrics ?? {}).map(([name, mm]) => (
                      <tr key={name} className="border-b border-line/60">
                        <td className="py-2 pr-3 font-medium">{name}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {formatNumber(mm.MAE)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {formatNumber(mm.RMSE)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {formatNumber(mm.R2, 3)}
                        </td>
                        <td className="py-2 font-mono text-xs">
                          {formatNumber(mm.Mean_Bias)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Ablation (Track B)" description="Identical 33 test rows">
              {m?.baselines ? (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(m.baselines).map(([name, b]) => (
                    <li key={name} className="flex justify-between gap-3">
                      <span className="text-fg-muted">{name}</span>
                      <span className="font-mono text-xs">
                        MAE {formatNumber(b.MAE)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Ablation unavailable" />
              )}
            </Card>

            <Card
              title="Statistical comparison"
              description="Documented in D-006 (Phase 2); not carried in the current metrics.json"
            >
              <dl className="grid grid-cols-2 gap-3">
                <Metric label="Wilcoxon p (ensemble vs persistence)" value="0.1495" />
                <Metric label="Bootstrap 95% CI" value="[-6.47, +1.39]" />
                <Metric label="Test rows" value={m?.split?.n_test ?? "—"} />
                <Metric label="Train rows" value={m?.split?.n_train ?? "—"} />
              </dl>
              <p className="mt-3 text-xs text-fg-muted">
                The interval spans zero, so the ensemble is not shown to beat
                persistence (D-006). Values above are quoted from the defect
                register; the run artifact exposes MAE/RMSE/R² only.
              </p>
            </Card>
          </div>

          <Card
            title="Seasonal experiment matrix (M0–M8)"
            description="Identical eligible dates and rolling-origin folds within each track"
          >
            {matrix.isLoading && <LoadingBlock rows={4} />}
            {matrix.isError && (
              <ErrorState
                message={(matrix.error as Error).message}
                onRetry={() => matrix.refetch()}
              />
            )}
            {mx && !mx.available && (
              <EmptyState
                title="Matrix unavailable"
                description={mx.reason ?? "run scripts/run_experiment_matrix.py"}
              />
            )}
            {mx?.available && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-0">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-muted">
                      <th className="py-2 pr-3">Config</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">n</th>
                      <th className="py-2 pr-3">MAE</th>
                      <th className="py-2 pr-3">RMSE</th>
                      <th className="py-2 pr-3">MedAE</th>
                      <th className="py-2">R²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mx.metrics ?? [])
                      .filter((row) => cell(row, "track") === track)
                      .map((row) => (
                        <tr
                          key={`${cell(row, "track")}-${cell(row, "config")}`}
                          className="border-b border-line/60"
                        >
                          <td className="py-2 pr-3 font-mono text-xs">
                            {cell(row, "config")}
                          </td>
                          <td className="py-2 pr-3">{cell(row, "model")}</td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {cell(row, "n")}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {formatNumber(numeric(row, "MAE"))}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {formatNumber(numeric(row, "RMSE"))}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {formatNumber(numeric(row, "MedianAE"))}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {formatNumber(numeric(row, "R2"), 3)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(mx.metrics ?? []).filter(
                  (row) => cell(row, "track") === track,
                ).length === 0 && (
                  <p className="mt-2 text-xs text-fg-muted">
                    No configurations recorded for Track {track}.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card
            title="Source ablation (paired)"
            description="delta MAE = config − reference on the same dates; negative is better"
          >
            {mx?.available &&
            (mx.ablations ?? []).filter(
              (row) => cell(row, "track") === track,
            ).length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {(mx.ablations ?? [])
                  .filter((row) => cell(row, "track") === track)
                  .map((row) => (
                    <li
                      key={`${cell(row, "config")}-${cell(row, "reference")}`}
                      className="flex justify-between gap-3"
                    >
                      <span className="text-fg-muted">
                        {cell(row, "config")} vs {cell(row, "reference")}
                      </span>
                      <span className="font-mono text-xs">
                        {formatNumber(numeric(row, "delta_MAE"))}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState
                title="Ablation unavailable"
                description={mx?.reason}
              />
            )}
          </Card>

          <Card
            title="Per-season source sufficiency"
            description="Declared thresholds: 30 rows to compare, 90 rows for a stable seasonal estimate"
          >
            {sufficiency.isLoading && <LoadingBlock rows={3} />}
            {sufficiency.isError && (
              <ErrorState
                message={(sufficiency.error as Error).message}
                onRetry={() => sufficiency.refetch()}
              />
            )}
            {sf && !sf.available && (
              <EmptyState
                title="Sufficiency unavailable"
                description={sf.reason}
              />
            )}
            {sf?.available && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-0">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-muted">
                      <th className="py-2 pr-3">Season</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Observed</th>
                      <th className="py-2 pr-3">Rows</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sf.rows ?? []).map((row) => (
                      <tr
                        key={`${cell(row, "season")}-${cell(row, "source")}`}
                        className="border-b border-line/60"
                      >
                        <td className="py-2 pr-3">{cell(row, "season")}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {cell(row, "source")}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {cell(row, "n_observed")}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {cell(row, "n_season_rows")}
                        </td>
                        <td className="py-2">
                          <StatusBadge status={cell(row, "status")} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}