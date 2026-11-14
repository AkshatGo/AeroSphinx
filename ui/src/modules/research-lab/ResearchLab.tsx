import { useState } from "react";
import { useExperiments } from "@/lib/queries";
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

export function ResearchLab() {
  const [track, setTrack] = useState<"A" | "B">("A");
  const [selected, setSelected] = useState<string>("A2");
  const experiments = useExperiments();
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
                <table className="w-full text-sm">
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
        </div>
      </div>
    </div>
  );
}