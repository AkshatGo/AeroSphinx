import { useCoverage, useExperiments, useStatus } from "@/lib/queries";
import { DEFECTS } from "@/lib/reference";
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

export function CommandCenter() {
  const status = useStatus();
  const coverage = useCoverage();
  const experiments = useExperiments();

  if (status.isLoading) return <LoadingBlock rows={5} />;
  if (status.isError)
    return (
      <ErrorState
        message={(status.error as Error).message}
        onRetry={() => status.refetch()}
      />
    );
  if (!status.data) return null;

  const s = status.data;
  const ds = s.dataset;
  const cov = coverage.data;
  const exp = experiments.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        tagline="Repository, datasets, coverage and research status — read from the live artifact API."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ground rows"
          value={ds.available ? ds.rows?.toLocaleString() : "—"}
          hint={ds.available ? `${ds.start} → ${ds.end}` : ds.reason}
          tone="accent"
          to="/data-observatory"
        />
        <StatCard
          label="All-source overlap"
          value={cov?.available ? formatPct(cov.all_sources_observed?.fraction) : "—"}
          hint={
            cov?.available
              ? `${cov.all_sources_observed?.observed} of ${cov.rows} rows`
              : "Coverage unavailable"
          }
          tone="warning"
          to="/data-observatory"
        />
        <StatCard
          label="Defects tracked"
          value={String(DEFECTS.length)}
          hint={`D-001 … D-020 · ${
            DEFECTS.filter(
              (d) => d.severity === "Critical" && d.status !== "FIXED" && d.status !== "CLOSED",
            ).length
          } open critical`}
          to="/defect-register"
        />
        <StatCard
          label="Latest experiment"
          value={exp?.configuration ?? "—"}
          hint={exp?.generated ? `generated ${exp.generated}` : "no metrics.json"}
          to="/research-lab"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Repository" description="From git at request time">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Branch</dt>
              <dd className="font-mono text-xs">{s.repo.branch ?? "unavailable"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Commit</dt>
              <dd className="font-mono text-xs">
                {s.repo.short_sha ?? "unavailable"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Working tree</dt>
              <dd>
                {s.repo.dirty ? (
                  <StatusBadge status="WARNING" label="uncommitted changes" />
                ) : (
                  <StatusBadge status="PASS" label="clean" />
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">API generated</dt>
              <dd className="font-mono text-[11px]">{s.generated}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Source availability" description="Same-day observations in the fused frame">
          {cov?.available ? (
            <ul className="space-y-2 text-sm">
              {(
                [
                  ["Station meteorology", cov.sources?.station_met],
                  ["MERRA-2 reanalysis", cov.sources?.merra],
                  ["INSAT-3D AOD", cov.sources?.aod],
                ] as const
              ).map(([label, v]) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">{label}</span>
                  <span className="font-mono text-xs">
                    {v?.observed ?? 0} ({formatPct(v?.fraction)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Coverage unavailable" description="Start the API server." />
          )}
        </Card>

        <Card title="Track summaries">
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-accent">Track A · historical CPCB</p>
              <p className="text-xs text-fg-muted">
                9-year rolling-origin backtest. No learned model significantly
                beats persistence at one-day horizon (Wilcoxon p = 0.1495).
              </p>
            </div>
            <div>
              <p className="font-medium text-accent">Track B · multisource</p>
              <p className="text-xs text-fg-muted">
                Retrospective estimation only. Ground-only MAE 16.617 vs full
                fusion 17.298 — fusion does not beat ground-only (D-007).
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Research highlights"
        description="Sourced from the defect register and phase reports"
      >
        <ul className="space-y-2 text-sm text-fg-muted">
          <li>
            • The fused dataset preserves all ground rows and never fills an
            environmental value; missing values remain{" "}
            <code className="text-fg">NaN</code> with per-source observation age.
          </li>
          <li>
            • Satellite and reanalysis overlap the ground record on a small
            minority of days confined to 2024, so any Track B claim is a
            matched-date comparison, stated as such.
          </li>
          <li>
            • The five-day exercise is retrospective: future observed AOD and
            MERRA-2 are forbidden inputs under the availability contract.
          </li>
          <li>
            • A corrupt station pressure column (D-020) was found by
            cross-validating MERRA-2 against the station, not the station against
            itself.
          </li>
        </ul>
      </Card>
    </div>
  );
}