import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryResponse } from "@fx/core/api";
import { useApi } from "../providers";
import { assetLabel, directionArrow, formatDayShort, formatSpan, gradeShort, isAssetId, rangeFor, type RangeKey } from "../format";
import { ErrorNote, Icon, LoadingBlock, PageHeader } from "../ui";

const RANGES: RangeKey[] = ["1M", "3M", "6M", "YTD"];
const MIX = [
  { key: "long", name: "Long", color: "#4c94f7" },
  { key: "short", name: "Short", color: "#e8923a" },
  { key: "stand_aside", name: "Stand aside", color: "#8b95a8" },
  { key: "failed", name: "Failed", color: "#f07178" },
] as const;

export function HistoryPage() {
  const { asset = "nasdaq100" } = useParams();
  const api = useApi();
  const rangeKey = useRange();
  const bounds = rangeFor(rangeKey);
  const query = useQuery({
    queryKey: ["history", asset, bounds.from, bounds.to],
    queryFn: () => api.getHistory(asset, bounds.from, bounds.to),
    enabled: isAssetId(asset),
  });
  if (!isAssetId(asset)) return <ErrorNote error={new Error("Unknown asset.")} />;
  return (
    <>
      <PageHeader title="History" kicker />
      <div className="history-controls">
        <div className="segment asset-toggle" role="group" aria-label="Asset">
          {(["nasdaq100", "gold"] as const).map((item) => (
            <Link key={item} to={`/a/${item}?range=${rangeKey}`} aria-current={item === asset ? "page" : undefined} className={item === asset ? "on" : ""}>
              {assetLabel(item)}
            </Link>
          ))}
        </div>
        <div className="range-row">
          <div className="range-chips" role="group" aria-label="Range">
            {RANGES.map((item) => (
              <Link key={item} to={`/a/${asset}?range=${item}`} className={`chip-btn${item === rangeKey ? " on" : ""}`} aria-current={item === rangeKey ? "true" : undefined}>
                {item}
              </Link>
            ))}
          </div>
          <span className="span-label">{query.data ? formatSpan(query.data.from, query.data.to) : formatSpan(bounds.from, bounds.to)}</span>
        </div>
      </div>
      {query.isLoading ? <LoadingBlock label="Loading history" /> : null}
      {query.isError ? <ErrorNote error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <HistoryBody data={query.data} asset={asset} /> : null}
    </>
  );
}

function useRange(): RangeKey {
  const [params] = useSearchParams();
  const value = params.get("range");
  if (value === "1M" || value === "3M" || value === "6M" || value === "YTD") return value;
  return "1M";
}

function HistoryBody({ data, asset }: { data: HistoryResponse; asset: string }) {
  const rows = [...data.rows].sort((a, b) => a.date.localeCompare(b.date));
  const mix = MIX.map((item) => ({
    ...item,
    value: rows.filter((row) => (item.key === "failed" ? !row.ok : row.ok && row.direction === item.key)).length,
  })).filter((item) => item.value > 0);
  const analysed = rows.filter((row) => row.ok && row.checklist && row.checklist.length > 0);
  const counts = new Map<string, number>();
  for (const row of analysed) {
    for (const item of row.checklist ?? []) {
      if (item.result === "NOT VISIBLE") counts.set(item.item, (counts.get(item.item) ?? 0) + 1);
    }
  }
  const bars = [...counts.entries()]
    .map(([item, nv]) => ({ item, percent: analysed.length ? Math.round((nv / analysed.length) * 100) : 0 }))
    .sort((a, b) => b.percent - a.percent || a.item.localeCompare(b.item));
  const first = rows[0]?.date;
  const last = rows[rows.length - 1]?.date;
  return (
    <div className="history-grid">
      <section className="card">
        <h2>Direction & grade by day</h2>
        {rows.length === 0 ? <p className="muted">No days in this range.</p> : null}
        <div className="tile-grid">
          {rows.map((row) => {
            const tone = !row.ok ? "failed" : row.direction === "short" ? "short" : row.direction === "stand_aside" ? "stand" : "long";
            const href = row.ok ? `/r/${asset}/${row.date}` : `/d/${row.date}`;
            return (
              <Link key={row.date} to={href} className={`tile tile-${tone}${row.grade === "A+" ? " grade-a" : ""}`} title={row.date}>
                <span>{row.ok ? directionArrow(row.direction ?? "stand_aside") : "×"}</span>
                <span>{row.ok ? gradeShort(row.grade ?? "NT") : ""}</span>
              </Link>
            );
          })}
        </div>
        {first && last ? (
          <div className="strip-dates">
            <span>{formatDayShort(first)}</span>
            <span>{formatDayShort(last)}</span>
          </div>
        ) : null}
        <hr className="section-rule" />
        <h3>Direction mix</h3>
        {mix.length === 0 ? (
          <p className="muted">No directions in range.</p>
        ) : (
          <div className="mix">
            <div className="mix-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="var(--card)" strokeWidth={3} isAnimationActive={false}>
                    {mix.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mix-legend">
              {MIX.map((item) => (
                <li key={item.name}>
                  <i style={{ background: item.color }} />
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="card">
        <h2>How often each item was NOT VISIBLE</h2>
        <p className="muted">Share of analysed days in range</p>
        {bars.length === 0 ? (
          <p className="muted">No checklist rows in this range.</p>
        ) : (
          <div className="chart chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical" margin={{ top: 8, right: 36, left: 8, bottom: 0 }} barSize={12}>
                <CartesianGrid horizontal={false} stroke="var(--line)" />
                <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="item" width={148} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <Bar dataKey="percent" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {bars.map((item) => (
                    <Cell key={item.item} fill={item.percent >= 50 ? "#e0a84a" : "#8b95a8"} />
                  ))}
                  <LabelList dataKey="percent" position="right" formatter={(value: unknown) => `${Number(value)}%`} fill="var(--text)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="callout">
          <Icon name="info" />
          <p>Items that need a frame outside the captured set are rarely visible. This is the chart-role mismatch (gap #1) showing up over time.</p>
        </div>
      </section>
    </div>
  );
}
