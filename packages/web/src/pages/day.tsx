import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { AssetDay, ReportResponse } from "@fx/core/api";
import { useAuth } from "../auth";
import { useApi } from "../providers";
import { assetLabel, directionArrow, directionLabel, formatDay, formatSastClock, shiftWeekday } from "../format";
import { CheckCounts, ErrorNote, gradeClass, Icon, LoadingBlock, PageHeader, StackedBar, StatusPill } from "../ui";

export function DayPage() {
  const { date = "" } = useParams();
  const api = useApi();
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["day", date],
    queryFn: () => api.getDay(date),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const rerun = useMutation({
    mutationFn: (input: { asset: "nasdaq100" | "gold"; phase: "full" | "analyse" }) =>
      input.phase === "full" ? api.startRun({ date, asset: input.asset, force: true }) : api.startAnalyse({ date, asset: input.asset }),
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <ErrorNote error={new Error("That date is not valid.")} />;
  if (query.isLoading) return <LoadingBlock label="Loading day" />;
  if (query.isError) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;
  const detail = query.data;
  if (!detail) return <ErrorNote error={new Error("No run recorded for this date")} />;

  const prev = shiftWeekday(date, -1);
  const next = shiftWeekday(date, 1);
  return (
    <>
      <PageHeader
        title={formatDay(date, true)}
        subtitle={detail.summary.executionName}
        back={{ to: "/", label: "Back to days" }}
        trailing={<StatusPill status={detail.summary.status} />}
        detail
      />
      <div className="asset-grid">
        <AssetCard
          asset="nasdaq100"
          date={date}
          summary={detail.summary.assets.nasdaq100}
          report={detail.reports.nasdaq100}
          failure={detail.failures.find((item) => item.asset === "nasdaq100")}
          isAdmin={auth.isAdmin}
          pending={rerun.isPending}
          started={rerun.variables?.asset === "nasdaq100" ? rerun.data?.executionName : undefined}
          onRun={(phase) => rerun.mutate({ asset: "nasdaq100", phase })}
        />
        <AssetCard
          asset="gold"
          date={date}
          summary={detail.summary.assets.gold}
          report={detail.reports.gold}
          failure={detail.failures.find((item) => item.asset === "gold")}
          isAdmin={auth.isAdmin}
          pending={rerun.isPending}
          started={rerun.variables?.asset === "gold" ? rerun.data?.executionName : undefined}
          onRun={(phase) => rerun.mutate({ asset: "gold", phase })}
        />
      </div>
      {rerun.isError ? <p className="form-error">{rerun.error instanceof Error ? rerun.error.message : "Could not start the run."}</p> : null}
      <div className="day-footer">
        <Link className="card link-card run-link" to={`/runs/${date}`}>
          <span>
            <strong>Run log</strong>
            <small>Step timings, tokens, cache, errors</small>
          </span>
          <Icon name="chevronRight" />
        </Link>
        <Link className="card link-card prev" to={`/d/${prev}`}>
          <Icon name="chevronLeft" />
          <span>{formatDay(prev)}</span>
        </Link>
        <Link className="card link-card next" to={`/d/${next}`}>
          <span>{formatDay(next)}</span>
          <Icon name="chevronRight" />
        </Link>
      </div>
    </>
  );
}

function AssetCard({
  asset,
  date,
  summary,
  report,
  failure,
  isAdmin,
  pending,
  started,
  onRun,
}: {
  asset: "nasdaq100" | "gold";
  date: string;
  summary?: AssetDay;
  report: ReportResponse | null;
  failure?: { error: string; step?: string };
  isAdmin: boolean;
  pending: boolean;
  started?: string;
  onRun: (phase: "full" | "analyse") => void;
}) {
  const failed = !summary?.ok;
  const when = report?.analysis.generated_at_utc ? formatSastClock(report.analysis.generated_at_utc) : null;
  const counts = summary?.checklist;
  const direction = summary?.direction ?? "stand_aside";
  return (
    <article className={`card asset-card${failed ? " card-failed" : ""}`}>
      <div className="row-head">
        <h2>{assetLabel(asset)}</h2>
        {failed ? <span className="pill pill-failed">Failed</span> : when ? <span className="when">{when}</span> : null}
      </div>
      {failed ? (
        <>
          <div className="error-box">
            <p className="error-step">step · {failure?.step ?? `capture-${asset}`}</p>
            <p className="error-text">{failure?.error ?? summary?.error ?? "Capture failed."}</p>
          </div>
          <p>No report or brief was written. Telegram marked this asset “no brief”.</p>
          {isAdmin ? (
            <div className="btn-row">
              <button className="btn btn-primary" type="button" disabled={pending} onClick={() => onRun("full")}>
                Re-run capture + analyse
              </button>
              <button className="btn" type="button" disabled={pending} onClick={() => onRun("analyse")}>
                Analyse only
              </button>
            </div>
          ) : (
            <p className="hint">Re-run is limited to the admins group.</p>
          )}
          {started ? <p className="form-ok">Started {started}</p> : null}
          <p className="hint">
            Re-runs start a forced execution <code>run-{date}-…</code> — cron ids can't carry force.
          </p>
        </>
      ) : (
        <>
          <div className="verdict-line">
            <span className={`direction-lg dir-${direction}`}>
              {directionArrow(direction)} {directionLabel(direction)}
            </span>
            {summary?.grade ? <span className={`grade grade-${gradeClass(summary.grade)}`}>{summary.grade === "NO TRADE" ? "NT" : summary.grade}</span> : null}
            {summary?.confidence ? (
              <span className="confidence">
                confidence <strong>{summary.confidence}</strong>
              </span>
            ) : null}
          </div>
          {counts ? (
            <>
              <StackedBar pass={counts.pass} fail={counts.fail} notVisible={counts.notVisible} />
              <CheckCounts pass={counts.pass} fail={counts.fail} notVisible={counts.notVisible} />
            </>
          ) : null}
          {report?.analysis.verdict.reason ? <p className="reason">{report.analysis.verdict.reason}</p> : null}
          {summary?.captureQuality === "poor" ? <p className="hint">Poor capture — bias is still in the report.</p> : null}
          {report && report.charts.length > 0 ? (
            <div className="shots">
              {report.charts.map((chart) => (
                <figure key={chart.timeframe} className="shot">
                  <img src={chart.url} alt={`${chart.timeframe} screenshot`} />
                  <figcaption>{chart.timeframe} · screenshot</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          <Link className="report-link" to={`/r/${asset}/${date}`}>
            Open full report <Icon name="chevronRight" size={16} />
          </Link>
        </>
      )}
    </article>
  );
}
