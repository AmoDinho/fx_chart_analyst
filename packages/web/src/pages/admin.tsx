import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Asset } from "@fx/core/capture/config";
import { isUtcDate } from "@fx/core/capture/config";
import { useAuth } from "../auth";
import { useApi } from "../providers";
import { assetLabel, formatDuration, formatExecWhen, previewExecutionName, todaySast, type AssetChoice } from "../format";
import { ErrorNote, LoadingBlock, PageHeader } from "../ui";

const TIMEFRAMES = ["1D", "3h", "30m"] as const;

export function AdminPage() {
  const auth = useAuth();
  const api = useApi();
  const client = useQueryClient();
  const [date, setDate] = useState(todaySast);
  const [asset, setAsset] = useState<AssetChoice>("both");
  const [force, setForce] = useState(false);
  const [shotAsset, setShotAsset] = useState<Asset>("nasdaq100");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("3h");
  const [shotId, setShotId] = useState<string | null>(null);
  const [previewPhase, setPreviewPhase] = useState<"full" | "analyse">("full");
  const status = useQuery({
    queryKey: ["admin", "status"],
    queryFn: () => api.getStatus(),
    enabled: auth.isAdmin,
  });
  const startShot = useMutation({
    mutationFn: () => api.startScreenshot({ asset: shotAsset, timeframe }),
    onSuccess: (result) => setShotId(result.id),
  });
  const shot = useQuery({
    queryKey: ["screenshot", shotId],
    queryFn: () => api.getScreenshot(shotId ?? ""),
    enabled: Boolean(shotId),
    refetchInterval: (query) => (query.state.data?.ready ? false : 1200),
  });
  const run = useMutation({
    mutationFn: (phase: "full" | "analyse") => {
      const body = { date, asset: asset === "both" ? undefined : asset, force };
      return phase === "full" ? api.startRun(body) : api.startAnalyse(body);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin", "status"] }),
  });
  useEffect(() => {
    setShotId(null);
  }, [shotAsset, timeframe]);

  const preview = previewExecutionName({ date, asset, force, phase: previewPhase });
  const dateOk = isUtcDate(date);
  const capturing = startShot.isPending || Boolean(shotId && !shot.data?.ready);

  return (
    <>
      <PageHeader title="Admin" kicker trailing={auth.isAdmin ? <span className="group-chip">admins group</span> : null} />
      {!auth.isAdmin ? (
        <div className="banner banner-readonly" role="status">
          You are signed in, but not in the admins group. Start actions are hidden.
        </div>
      ) : null}
      <div className="admin-grid">
        <section className="card">
          <h2>Start a run</h2>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={!auth.isAdmin} />
          </label>
          <div className="field">
            <span>Asset</span>
            <div className="segment" role="group" aria-label="Asset">
              {(["both", "nasdaq100", "gold"] as const).map((item) => (
                <button key={item} type="button" aria-pressed={asset === item} disabled={!auth.isAdmin} onClick={() => setAsset(item)}>
                  {item === "both" ? "Both" : item === "nasdaq100" ? "Nasdaq" : "Gold"}
                </button>
              ))}
            </div>
          </div>
          <div className="force-row">
            <div>
              <strong>Force</strong>
              <p>Re-capture and overwrite existing reports</p>
            </div>
            <button className={`switch${force ? " on" : ""}`} type="button" role="switch" aria-checked={force} disabled={!auth.isAdmin} onClick={() => setForce((value) => !value)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="name-preview">
            <span>Execution name</span>
            <strong>{preview}</strong>
          </div>
          {auth.isAdmin ? (
            <div className="btn-row even">
              <button className="btn btn-primary" type="button" disabled={!dateOk || run.isPending} onMouseEnter={() => setPreviewPhase("full")} onFocus={() => setPreviewPhase("full")} onClick={() => run.mutate("full")}>
                Full run
              </button>
              <button className="btn" type="button" disabled={!dateOk || run.isPending} onMouseEnter={() => setPreviewPhase("analyse")} onFocus={() => setPreviewPhase("analyse")} onClick={() => run.mutate("analyse")}>
                Analyse only
              </button>
            </div>
          ) : null}
          {run.data ? <p className="form-ok">Started {run.data.executionName}</p> : null}
          {run.isError ? <p className="form-error">{run.error instanceof Error ? run.error.message : "Could not start the run."}</p> : null}
        </section>
        <section className="card">
          <h2>Recent executions</h2>
          {!auth.isAdmin ? <p className="muted">Recent executions are visible to the admins group.</p> : null}
          {status.isLoading ? <LoadingBlock label="Loading executions" /> : null}
          {status.isError ? <ErrorNote error={status.error} onRetry={() => void status.refetch()} /> : null}
          <div className="exec-list">
            {status.data?.executions.map((item) => (
              <div className="exec-row" key={`${item.name}-${item.startedAt ?? ""}`}>
                <span className={`dot dot-${tone(item.status)}`} />
                <div className="exec-main">
                  <p className="exec-name">{item.name}</p>
                  <p className="muted">{executionMeta(item)}</p>
                </div>
                <span className={`exec-status tone-${tone(item.status)}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card screenshot-card">
          <h2>Live screenshot</h2>
          <div className="shot-tools">
            <div className="range-chips" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((item) => (
                <button key={item} type="button" className={`chip-btn${timeframe === item ? " on" : ""}`} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>
                  {item}
                </button>
              ))}
            </div>
            <button className="text-asset" type="button" onClick={() => setShotAsset((value) => (value === "nasdaq100" ? "gold" : "nasdaq100"))} title="Switch asset">
              {assetLabel(shotAsset)}
            </button>
          </div>
          <div className="stage">
            {shot.data?.url ? <img src={shot.data.url} alt={`${assetLabel(shotAsset)} ${timeframe} live screenshot`} /> : <p>{capturing ? "Capturing…" : "Not stored — expires after a day"}</p>}
          </div>
          {auth.isAdmin ? (
            <button className="btn capture-btn" type="button" disabled={capturing} onClick={() => startShot.mutate()}>
              {capturing ? "Capturing…" : "Capture now"}
            </button>
          ) : null}
          {startShot.isError ? <p className="form-error">{startShot.error instanceof Error ? startShot.error.message : "Capture failed to start."}</p> : null}
        </section>
      </div>
    </>
  );
}

function tone(status: string): "ok" | "partial" | "failed" | "running" {
  const value = status.toLowerCase();
  if (value.includes("fail")) return "failed";
  if (value.includes("partial")) return "partial";
  if (value.includes("run")) return "running";
  return "ok";
}

function executionMeta(item: { name: string; startedAt: string | null; durationMs: number | null }): string {
  const when = item.startedAt ? formatExecWhen(item.startedAt) : "—";
  const manual = item.name.startsWith("run-") ? "manual, force" : null;
  const duration = item.durationMs != null && !manual ? formatDuration(item.durationMs) : null;
  return [when, duration, manual].filter(Boolean).join(" · ");
}
