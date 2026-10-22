import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ChartAnalysis } from "@fx/core/analysis/schema";
import type { ReportResponse } from "@fx/core/api";
import { extractRange, formatPrice, rangePercent, type RangeRead } from "@fx/core/report/range";
import { useApi } from "../providers";
import { assetLabel, biasClass, biasLabel, formatDay, formatHmUtc, isAssetId } from "../format";
import { MarkdownView } from "../markdown";
import { ErrorNote, GradeBadge, Icon, LoadingBlock, PageHeader } from "../ui";

type Tab = "analysis" | "markdown" | "json";

export function ReportPage() {
  const { asset = "", date = "" } = useParams();
  const api = useApi();
  const enabled = isAssetId(asset) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const query = useQuery({
    queryKey: ["report", asset, date],
    queryFn: () => api.getReport(asset, date),
    enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const [tab, setTab] = useState<Tab>("analysis");
  const markdown = useQuery({
    queryKey: ["markdown", asset, date],
    queryFn: () => api.getMarkdown(asset, date),
    enabled: enabled && tab === "markdown" && !query.data?.markdown,
    staleTime: 10 * 60 * 1000,
  });

  if (!enabled) return <ErrorNote error={new Error("That report link is not valid.")} />;
  if (query.isLoading) return <LoadingBlock label="Loading report" />;
  if (query.isError || !query.data) return <ErrorNote error={query.error ?? new Error("No report for this asset on this date")} onRetry={() => void query.refetch()} />;

  const report = query.data;
  return (
    <ReportView
      asset={asset}
      date={date}
      report={report}
      tab={tab}
      onTab={setTab}
      markdown={report.markdown ?? markdown.data}
      markdownLoading={markdown.isLoading && !report.markdown}
    />
  );
}

export function ReportView({
  asset,
  date,
  report,
  tab = "analysis",
  onTab,
  markdown,
  markdownLoading = false,
}: {
  asset: string;
  date: string;
  report: ReportResponse;
  tab?: Tab;
  onTab?: (tab: Tab) => void;
  markdown?: string;
  markdownLoading?: boolean;
}) {
  const [localTab, setLocalTab] = useState<Tab>(tab);
  const current = onTab ? tab : localTab;
  const setTab = onTab ?? setLocalTab;
  const generated = formatHmUtc(report.analysis.generated_at_utc);
  return (
    <>
      <PageHeader
        title={assetLabel(asset)}
        subtitle={`${formatDay(date, true)} · generated ${generated} UTC`}
        back={{ to: `/d/${date}`, label: "Back to day" }}
        trailing={<ShareButton />}
        detail
      />
      <div className="segment report-tabs" role="tablist" aria-label="Report format">
        {(["analysis", "markdown", "json"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={current === item} onClick={() => setTab(item)}>
            {item === "analysis" ? "Analysis" : item === "markdown" ? "Markdown" : "JSON"}
          </button>
        ))}
      </div>
      {current === "analysis" ? <AnalysisView report={report} /> : null}
      {current === "markdown" ? (
        markdownLoading ? <LoadingBlock label="Loading markdown" /> : (
          <div className="card">
            <MarkdownView markdown={markdown ?? "No markdown for this report."} />
          </div>
        )
      ) : null}
      {current === "json" ? <pre className="json">{JSON.stringify(report.analysis, null, 2)}</pre> : null}
      <p className="disclaimer">
        Model-generated chart reading for personal study. Not financial advice. {report.analysis.model} · prompt v{report.analysis.prompt_version} · schema v{report.analysis.schema_version}.
      </p>
    </>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn"
      type="button"
      aria-label={copied ? "Copied link" : "Share report"}
      title={copied ? "Copied" : "Copy link"}
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <Icon name="share" />
    </button>
  );
}

export function AnalysisView({ report }: { report: ReportResponse }) {
  const analysis = report.analysis;
  const poor = analysis.capture.capture_quality === "poor";
  const uncited = !poor && analysis.method_citations.length === 0;
  const range = extractRange(analysis);
  return (
    <div className="analysis">
      {poor ? (
        <div className="banner banner-poor" role="alert" aria-label="Poor capture warning">
          <strong>Poor capture.</strong> Capture warning: chart capture quality is poor.
          {analysis.capture.notes ? ` ${analysis.capture.notes}` : ""} Bias and verdict are shown so you can judge them yourself.
        </div>
      ) : null}
      {uncited ? (
        <div className="banner banner-ground" role="alert" aria-label="Grounding warning">
          <strong>Grounding warning.</strong> method_citations is empty. The model did not cite the methodology.
        </div>
      ) : null}
      <div className="report-grid">
        <div className="stack">
          <VerdictCard analysis={analysis} />
          <BiasCard analysis={analysis} range={range} />
          <Timeframes analysis={analysis} />
          <Checklist analysis={analysis} />
        </div>
        <div className="stack">
          <Charts report={report} />
          <ClaimList title="Confluence" tone="confluence" items={analysis.confluence.map((item) => item.claim)} />
          <ClaimList title="Conflicts" tone="conflict" items={analysis.conflicts.map((item) => item.claim)} />
          <section className="card invalidation">
            <h2>Invalidation</h2>
            {analysis.invalidation.length === 0 ? <p className="muted">None recorded.</p> : null}
            {analysis.invalidation.map((item) => (
              <p key={item.condition}>
                {item.condition}
                {item.level && !item.condition.includes(item.level) ? ` (${item.level})` : ""}
              </p>
            ))}
          </section>
          <section className="card">
            <h2>Method citations</h2>
            {analysis.method_citations.length === 0 ? <p className="muted">None.</p> : null}
            <div className="chips">
              {analysis.method_citations.map((item) => (
                <span key={`${item.section}-${item.claim}`} className="cite" title={item.claim}>
                  {item.section}
                </span>
              ))}
            </div>
          </section>
          <ClaimList title="Caveats" tone="plain" items={analysis.caveats} />
        </div>
      </div>
    </div>
  );
}

function VerdictCard({ analysis }: { analysis: ChartAnalysis }) {
  const pass = analysis.verdict.checklist.filter((item) => item.result === "PASS").length;
  const fail = analysis.verdict.checklist.filter((item) => item.result === "FAIL").length;
  const nv = analysis.verdict.checklist.filter((item) => item.result === "NOT VISIBLE").length;
  const direction = analysis.verdict.direction;
  return (
    <section className="card verdict-card" data-testid="verdict" aria-label="Verdict">
      <p className="eyebrow">VERDICT</p>
      <div className="verdict-line">
        <span className={`direction-lg dir-${direction}`}>
          {direction === "short" ? "↓" : direction === "stand_aside" ? "–" : "↑"} {direction === "short" ? "Short" : direction === "stand_aside" ? "Stand aside" : "Long"}
        </span>
        <GradeBadge grade={analysis.verdict.grade} />
      </div>
      <p className="verdict-meta">
        <span>
          Confidence <strong>{analysis.confidence}</strong>
        </span>
        <span>
          Checklist <strong className="c-pass">{pass}</strong> / <strong className="c-fail">{fail}</strong> / <strong className="c-nv">{nv}</strong>
        </span>
      </p>
      {analysis.verdict.reason ? <p className="reason">{analysis.verdict.reason}</p> : null}
    </section>
  );
}

function BiasCard({ analysis, range }: { analysis: ChartAnalysis; range: RangeRead | null }) {
  return (
    <section className="card range-card" data-testid="bias" aria-label="Bias">
      <div className="row-head">
        <h2>Bias & dealing range</h2>
        <span className={`bias-word ${biasClass(analysis.bias.direction)}`}>{biasLabel(analysis.bias.direction)}</span>
      </div>
      {analysis.bias.rationale ? <p className="reason">{analysis.bias.rationale}</p> : null}
      {range ? <RangeRail range={range} /> : null}
    </section>
  );
}

function RangeRail({ range }: { range: RangeRead }) {
  const closeAt = rangePercent(range.close, range.low, range.high);
  return (
    <div className="rail-wrap" aria-label={`Dealing range ${formatPrice(range.low)} to ${formatPrice(range.high)}, close in ${range.side}`}>
      <div className="rail-track">
        <span className="rail-eq" style={{ bottom: `${rangePercent(range.equilibrium, range.low, range.high)}%` }} />
        <span className={`rail-mark side-${range.side}`} style={{ bottom: `${closeAt}%` }} />
      </div>
      <div className="rail-labels">
        <span className="num">{formatPrice(range.high)}</span>
        <span className={range.side === "premium" ? "side-premium" : "side-faint"}>Premium</span>
        <span className={range.side === "discount" ? "side-discount" : "side-faint"}>Discount</span>
        <span className="num">{formatPrice(range.low)}</span>
      </div>
    </div>
  );
}

function Timeframes({ analysis }: { analysis: ChartAnalysis }) {
  return (
    <section className="card">
      <h2>Timeframes</h2>
      {analysis.timeframes.length === 0 ? <p className="muted">None recorded.</p> : null}
      {analysis.timeframes.map((frame) => (
        <div className="tf-row" key={frame.timeframe}>
          <strong>{frame.timeframe}</strong>
          <div>
            {frame.structure ? <div className={`tf-bias ${biasClass(frame.structure)}`}>{frame.structure}</div> : null}
            {frame.notes ? <p>{frame.notes}</p> : null}
          </div>
        </div>
      ))}
    </section>
  );
}

function Checklist({ analysis }: { analysis: ChartAnalysis }) {
  return (
    <section className="card">
      <h2>Checklist</h2>
      {analysis.verdict.checklist.map((item) => (
        <div className="check-row" key={item.item}>
          <span>{item.item}</span>
          <span className={`badge badge-${item.result === "PASS" ? "pass" : item.result === "FAIL" ? "fail" : "nv"}`}>{item.result}</span>
        </div>
      ))}
    </section>
  );
}

function Charts({ report }: { report: ReportResponse }) {
  const [zoom, setZoom] = useState<ReportResponse["charts"][number] | null>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  const quality = report.analysis.capture.capture_quality;
  return (
    <section className="card">
      <div className="row-head">
        <h2>Charts</h2>
        <span className="muted">Tap to zoom</span>
      </div>
      {report.charts.length === 0 ? <p className="muted">No charts.</p> : null}
      <div className="shots">
        {report.charts.map((chart) => (
          <button key={chart.timeframe} type="button" className="shot" onClick={() => setZoom(chart)}>
            <img src={chart.url} alt={`${chart.timeframe} chart`} />
            <span>
              {chart.timeframe} · {quality}
            </span>
          </button>
        ))}
      </div>
      {zoom ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={`${zoom.timeframe} chart`}>
          <div className="overlay-bar">
            <strong>
              {zoom.timeframe} · {zoom.width}×{zoom.height}
            </strong>
            <button type="button" className="btn" onClick={() => setZoom(null)}>
              Close
            </button>
          </div>
          <div className="overlay-scroll">
            <img src={zoom.url} width={zoom.width} height={zoom.height} alt={`${zoom.timeframe} chart at original resolution`} style={{ width: zoom.width, height: zoom.height, maxWidth: "none" }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ClaimList({ title, tone, items }: { title: string; tone: "confluence" | "conflict" | "plain"; items: string[] }) {
  return (
    <section className="card">
      <h2 className={tone === "plain" ? undefined : `h-${tone}`}>{title}</h2>
      {items.length === 0 ? <p className="muted">None.</p> : null}
      {items.length > 0 ? (
        <ul className="clean-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
