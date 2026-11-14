import { useDataset } from "@/lib/queries";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
  formatPct,
} from "@/components/ui/primitives";

const SOURCE_META = [
  {
    key: "aod_observed",
    name: "INSAT-3D AOD",
    provider: "ISRO / SAC",
    note: "139 dates, 2024 only. No QA/cloud flag dataset (D-004).",
    status: "WARNING" as const,
  },
  {
    key: "merra_observed",
    name: "MERRA-2",
    provider: "NASA GMAO",
    note: "172 dates, 2024 only. Midday single-cell values (D-010).",
    status: "WARNING" as const,
  },
  {
    key: "station_met_observed",
    name: "CPCB station meteorology",
    provider: "CPCB NAMP",
    note: "Full record. BP screened out (D-020); VWS 43% missing.",
    status: "PASS" as const,
  },
];

export function DataObservatory() {
  const dataset = useDataset();

  if (dataset.isLoading) return <LoadingBlock rows={5} />;
  if (dataset.isError)
    return (
      <ErrorState
        message={(dataset.error as Error).message}
        onRetry={() => dataset.refetch()}
      />
    );
  const d = dataset.data;
  if (!d?.available)
    return (
      <EmptyState
        title="Dataset unavailable"
        description={d?.reason ?? "fused_dataset.csv not found"}
      />
    );

  const missing = d.missingness ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Observatory"
        tagline="Source registry, coverage and missingness computed from the fused frame. Missing values are never treated as zero."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Rows" value={d.rows?.toLocaleString()} />
        <StatCard label="Columns" value={d.columns} />
        <StatCard
          label="Date range"
          value={
            <span className="text-base">
              {d.start} → {d.end}
            </span>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {SOURCE_META.map((src) => {
          const m = missing[src.key];
          return (
            <Card
              key={src.key}
              title={src.name}
              description={src.provider}
              actions={<StatusBadge status={src.status} />}
            >
              <p className="mb-2 text-xs text-fg-muted">{src.note}</p>
              {m ? (
                <p className="text-xs">
                  <span className="text-fg-muted">Missing: </span>
                  <span className="font-mono">
                    {m.missing} / {d.rows} ({formatPct(m.fraction)})
                  </span>
                </p>
              ) : (
                <p className="text-xs text-fg-muted">Column not present.</p>
              )}
            </Card>
          );
        })}
      </div>

      <Card
        title="Per-column missingness"
        description="Raw NaN counts from the fused frame — no substitution applied"
      >
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="py-2 pr-3">Column</th>
                <th className="py-2 pr-3">Missing</th>
                <th className="py-2">Fraction</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(missing)
                .sort((a, b) => b[1].fraction - a[1].fraction)
                .map(([col, v]) => (
                  <tr key={col} className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-mono text-xs">{col}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{v.missing}</td>
                    <td className="py-1.5 font-mono text-xs">
                      {formatPct(v.fraction)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Provenance & lineage" description="Recorded in run manifests">
          <ul className="space-y-2 text-xs text-fg-muted">
            <li>• Input SHA-256 hashes are recorded per run in the manifest.</li>
            <li>
              • Every feature has an availability class; a forward-filled value is
              never given the class of the column it fills.
            </li>
            <li>
              • The ground series defines the row calendar; sources cannot extend
              it.
            </li>
            <li>
              • Measurement time and availability time are distinct columns.
            </li>
          </ul>
        </Card>
        <Card title="Legacy preservation">
          <p className="text-xs text-fg-muted">
            The legacy single-script pipeline{" "}
            <code className="text-fg">aerosphinx_pipeline.py</code> is retained
            unchanged as the Phase 0 reproducibility baseline. It is not the
            research path and its forward-fill behaviour must not be reused for
            Track B experiments.
          </p>
        </Card>
      </div>
    </div>
  );
}