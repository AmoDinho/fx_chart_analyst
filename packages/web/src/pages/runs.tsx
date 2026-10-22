import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RunLog, RunsResponse } from "@fx/core/api";
import { utcDate } from "@fx/core/capture/config";
import { useApi } from "../providers";
import { assetLabel, formatDay, formatDuration, formatHmsUtc, formatTokens } from "../format";
import { ErrorNote, LoadingBlock, PageHeader } from "../ui";

const OUTCOME = { ok: "#3dce86", retried: "#e6b15c", failed: "#f07178" };

export function RunsRedirect() {
  return <Navigate to={`/runs/${utcDate()}`} replace />;
}

export function RunsPage() {
  const { date = "" } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ["runs", date],
    queryFn: () => api.getRuns(date),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const [picked, setPicked] = useState<string | null>(null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <ErrorNote error={new Error("That date is not valid.")} />;
  if (query.isLoading) return <LoadingBlock label="Loading run log" />;
  if (query.isError) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data) return <ErrorNote error={new Error("No run log for this date")} />;
  const selected = data.runs.find((run) => run.asset === picked) ?? data.runs[0];
  const clock = data.startedAt && data.finishedAt ? `${formatHmsUtc(data.startedAt)} → ${formatHmsUtc(data.finishedAt)} UTC` : null;
  return (
    <>
      <PageHeader
        title={`Run · ${formatDay(date)}`}
        subtitle={[data.executionName, clock].filter(Boolean).join(" · ")}
        back={{ to: `/d/${date}`, label: "Back to day" }}
        detail
      />
      {selected ? <RunBody data={data} selected={selected} onPick={setPicked} /> : <p className="muted">No asset runs recorded.</p>}
      <p className="footnote">Redacted run log — raw completion text is never served to the viewer.</p>
    </>
  );
}

function RunBody({ data, selected, onPick }: { data: RunsResponse; selected: RunLog; onPick: (asset: string) => void }) {
  const prompt = selected.promptTokens ?? 0;
  const cached = selected.cachedTokens ?? 0;
  const uncached = selected.uncachedTokens ?? Math.max(0, prompt - cached);
  const completion = selected.completionTokens ?? 0;
  const hit = prompt > 0 && selected.cachedTokens != null ? Math.round((cached / prompt) * 100) : null;
  const images = selected.framesVerified?.match(/^(\d+)\//)?.[1];
  const tokenMax = niceTokenMax(Math.max(prompt, completion));
  const stepMax = niceStepMax(Math.max(0, ...selected.steps.map((step) => step.durationMs)));
  const notes = selected.steps.filter((step) => step.note).map((step) => `${step.name} — ${step.note}`);
  return (
    <>
      <div className="segment runs-tabs" role="tablist" aria-label="Asset run">
        {data.runs.map((run) => (
          <button key={run.asset} type="button" role="tab" aria-selected={run.asset === selected.asset} onClick={() => onPick(run.asset)}>
            {assetLabel(run.asset)}
            {!run.ok ? <span className="tab-fail"> · failed</span> : null}
          </button>
        ))}
      </div>
      <div className="runs-grid">
        <div className="stack">
          <div className="stat-grid">
            <Stat label="Prompt tokens" value={selected.promptTokens == null ? "—" : formatTokens(selected.promptTokens)} sub={images ? `system + ${images} images` : "system + images"} />
            <Stat label="Cache hit" value={hit == null ? "—" : `${hit}%`} sub={selected.cachedTokens == null ? undefined : `${formatTokens(selected.cachedTokens)} cached`} />
            <Stat label="Completion" value={selected.completionTokens == null ? "—" : formatTokens(selected.completionTokens)} sub={selected.completionTokens == null ? undefined : "incl. reasoning"} />
            <Stat label="Finish reason" value={selected.finishReason ?? "—"} sub={finishSubtitle(selected)} />
          </div>
          <section className="card">
            <h2>Token usage</h2>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={[
                    { name: "Prompt", cached, uncached, completion: 0 },
                    { name: "Output", cached: 0, uncached: 0, completion },
                  ]}
                  margin={{ top: 8, right: 12, left: 8, bottom: 0 }}
                  barSize={16}
                >
                  <XAxis type="number" domain={[0, tokenMax]} ticks={tokenTicks(tokenMax)} tickFormatter={(value: number) => (value === 0 ? "0" : `${value / 1000}k`)} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={64} tick={{ fill: "var(--muted)", fontSize: 13 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                  <Bar dataKey="cached" stackId="tokens" fill="#3dce86" isAnimationActive={false} />
                  <Bar dataKey="uncached" stackId="tokens" fill="#e6b15c" isAnimationActive={false} />
                  <Bar dataKey="completion" stackId="tokens" fill="#4c94f7" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="chart-legend">
              <li><i className="swatch ok" /> Cached</li>
              <li><i className="swatch retried" /> Uncached</li>
              <li><i className="swatch completion" /> Completion</li>
            </ul>
          </section>
        </div>
        <section className="card">
          <div className="row-head">
            <h2>Step durations</h2>
            <ul className="chart-legend inline">
              <li><i className="swatch ok" /> ok</li>
              <li><i className="swatch retried" /> retried</li>
              <li><i className="swatch failed" /> failed</li>
            </ul>
          </div>
          <div className="chart chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={selected.steps} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 0 }} barSize={14}>
                <CartesianGrid horizontal={false} stroke="var(--line)" />
                <XAxis type="number" domain={[0, stepMax]} tickFormatter={(value: number) => `${Math.round(value / 1000)} s`} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={168} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} formatter={(value: unknown) => formatDuration(Number(value))} />
                <Bar dataKey="durationMs" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {selected.steps.map((step) => (
                    <Cell key={step.name} fill={OUTCOME[step.outcome]} />
                  ))}
                  <LabelList dataKey="durationMs" position="right" formatter={(value: unknown) => formatDuration(Number(value))} fill="var(--text)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {notes.length > 0 ? (
            <ul className="clean-list">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {selected.errors.map((error) => (
            <p key={error} className="form-error">
              {error}
            </p>
          ))}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <section className="card stat-card">
      <p className="label">{label}</p>
      <p className="value num">{value}</p>
      {sub ? <p className="sub">{sub}</p> : null}
    </section>
  );
}

function finishSubtitle(run: RunLog): string | undefined {
  if (run.errors[0]) return run.errors[0];
  if (run.finishReason === "stop") return "parsed first try";
  if (!run.finishReason) return undefined;
  return run.ok ? "parsed first try" : "did not finish";
}

function niceTokenMax(value: number): number {
  const padded = Math.max(5000, value * 1.08);
  const step = padded <= 20000 ? 5000 : padded <= 50000 ? 10000 : 20000;
  return Math.ceil(padded / step) * step;
}

function tokenTicks(max: number): number[] {
  const step = max <= 20000 ? 5000 : max / 4;
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);
  return ticks;
}

function niceStepMax(ms: number): number {
  const seconds = Math.max(60, (ms / 1000) * 1.05);
  const step = seconds <= 180 ? 45 : seconds <= 600 ? 60 : 120;
  return Math.ceil(seconds / step) * step * 1000;
}
