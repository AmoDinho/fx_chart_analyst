import { chartAnalysisSchema, EXAMPLE_ANALYSIS, type ChartAnalysis } from "@fx/core/analysis/schema";
import {
  daySummarySchema,
  reportResponseSchema,
  type AssetDay,
  type DaySummary,
  type ReportResponse,
  type RunsResponse,
} from "@fx/core/api";
import { eachWeekday } from "./format";

export type Check = { item: string; result: "PASS" | "FAIL" | "NOT VISIBLE" };
export type AssetId = "nasdaq100" | "gold";

export type DemoAsset = {
  ok: boolean;
  direction?: "long" | "short" | "stand_aside";
  grade?: "A+" | "B" | "NO TRADE";
  confidence?: "low" | "medium" | "high";
  captureQuality?: "ok" | "poor";
  error?: string;
  step?: string;
  reason?: string;
  checklist?: Check[];
  generatedAt?: string;
  report?: ReportResponse;
};

export type DemoDay = {
  date: string;
  executionName: string;
  status: DaySummary["status"];
  nasdaq100: DemoAsset;
  gold: DemoAsset;
};

const CHECK_ITEMS = [
  "Weekly open plotted",
  "Session high marked",
  "Daily bias defined",
  "30m structure aligned",
  "Liquidity swept",
  "Entry in discount",
  "Displacement after sweep",
  "Fair-value gap present",
  "Draw on liquidity visible",
  "Invalidation level clear",
] as const;

const NV_RATE: Record<(typeof CHECK_ITEMS)[number], number> = {
  "Weekly open plotted": 0.85,
  "Session high marked": 0.65,
  "Daily bias defined": 0.2,
  "30m structure aligned": 0.15,
  "Liquidity swept": 0.05,
  "Entry in discount": 0,
  "Displacement after sweep": 0.08,
  "Fair-value gap present": 0.1,
  "Draw on liquidity visible": 0.12,
  "Invalidation level clear": 0.06,
};

export function sparklineUrl(seed: number, width = 960, height = 540): string {
  const points: string[] = [];
  let y = height * (0.42 + (seed % 5) * 0.04);
  const steps = 28;
  for (let i = 0; i <= steps; i += 1) {
    const x = (i / steps) * (width - 96) + 48;
    y += (Math.sin(seed * 1.3 + i * 0.62) + Math.cos(seed * 0.4 + i * 0.31)) * (height / 22);
    y = Math.max(36, Math.min(height - 36, y));
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#10151d"/><polyline points="${points.join(" ")}" fill="none" stroke="#9aadc4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function charts(seed: number) {
  return (["1D", "3h", "30m"] as const).map((timeframe, index) => ({
    timeframe,
    url: sparklineUrl(seed + index * 17, 1200, 675),
    width: 1200,
    height: 675,
  }));
}

function makeAnalysis(input: {
  asset: string;
  generated_at_utc: string;
  capture?: Partial<ChartAnalysis["capture"]>;
  bias?: Partial<ChartAnalysis["bias"]>;
  timeframes?: ChartAnalysis["timeframes"];
  confluence?: ChartAnalysis["confluence"];
  conflicts?: ChartAnalysis["conflicts"];
  invalidation?: ChartAnalysis["invalidation"];
  method_citations?: ChartAnalysis["method_citations"];
  verdict?: Partial<ChartAnalysis["verdict"]>;
  confidence?: ChartAnalysis["confidence"];
  caveats?: string[];
}): ChartAnalysis {
  return chartAnalysisSchema.parse({
    ...EXAMPLE_ANALYSIS,
    model: "deepseek-flash",
    prompt_version: "2",
    schema_version: "2",
    asset: input.asset,
    generated_at_utc: input.generated_at_utc,
    capture: { ...EXAMPLE_ANALYSIS.capture, requested_timeframes: ["1D", "3h", "30m"], actual_timeframes: ["1D", "3h", "30m"], ...input.capture },
    bias: { ...EXAMPLE_ANALYSIS.bias, ...input.bias },
    timeframes: input.timeframes ?? EXAMPLE_ANALYSIS.timeframes,
    confluence: input.confluence ?? [],
    conflicts: input.conflicts ?? [],
    invalidation: input.invalidation ?? [],
    method_citations: input.method_citations ?? EXAMPLE_ANALYSIS.method_citations,
    verdict: { ...EXAMPLE_ANALYSIS.verdict, ...input.verdict },
    confidence: input.confidence ?? "medium",
    caveats: input.caveats ?? [],
  });
}

function markdownFor(analysis: ChartAnalysis): string {
  const warning =
    analysis.capture.capture_quality === "poor"
      ? "> **Capture warning:** chart capture quality is poor. Bias and trade plan are withheld in Markdown; the Analysis tab still shows them."
      : analysis.method_citations.length === 0
        ? "> **Grounding warning:** method_citations is empty. The model did not cite the methodology."
        : "";
  return [
    `# ${analysis.asset}`,
    "",
    warning,
    "",
    `Generated ${analysis.generated_at_utc}`,
    "",
    "## Verdict",
    "",
    `${analysis.verdict.direction} · ${analysis.verdict.grade} · ${analysis.confidence}`,
    analysis.verdict.reason ?? "",
    "",
    "## Bias",
    "",
    `Direction: ${analysis.bias.direction}`,
    analysis.bias.rationale ?? "",
    "",
    "## Checklist",
    "",
    ...analysis.verdict.checklist.map((item) => `- ${item.result}: ${item.item}`),
    "",
    "## Caveats",
    "",
    ...(analysis.caveats.length ? analysis.caveats.map((item) => `- ${item}`) : ["None."]),
    "",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

function report(analysis: ChartAnalysis, seed: number): ReportResponse {
  return reportResponseSchema.parse({
    analysis,
    charts: charts(seed),
    markdown: markdownFor(analysis),
  });
}

const OCT22_CHECKS: Check[] = [
  { item: "Daily bias defined", result: "PASS" },
  { item: "Liquidity swept", result: "PASS" },
  { item: "Displacement after sweep", result: "PASS" },
  { item: "Fair-value gap present", result: "PASS" },
  { item: "Entry in discount", result: "PASS" },
  { item: "Draw on liquidity visible", result: "PASS" },
  { item: "Invalidation level clear", result: "PASS" },
  { item: "30m structure aligned", result: "FAIL" },
  { item: "Session high marked", result: "NOT VISIBLE" },
  { item: "Weekly open plotted", result: "NOT VISIBLE" },
];

const OCT20_CHECKS: Check[] = [
  { item: "Daily bias defined", result: "PASS" },
  { item: "Liquidity swept", result: "PASS" },
  { item: "Displacement after sweep", result: "PASS" },
  { item: "Fair-value gap present", result: "PASS" },
  { item: "Entry in discount", result: "PASS" },
  { item: "30m structure aligned", result: "FAIL" },
  { item: "Draw on liquidity visible", result: "FAIL" },
  { item: "Session high marked", result: "NOT VISIBLE" },
  { item: "Weekly open plotted", result: "NOT VISIBLE" },
  { item: "Invalidation level clear", result: "NOT VISIBLE" },
];

const POOR_CHECKS: Check[] = [
  { item: "Daily bias defined", result: "PASS" },
  { item: "Liquidity swept", result: "NOT VISIBLE" },
  { item: "Displacement after sweep", result: "NOT VISIBLE" },
  { item: "Fair-value gap present", result: "FAIL" },
  { item: "Entry in discount", result: "NOT VISIBLE" },
  { item: "Draw on liquidity visible", result: "FAIL" },
  { item: "Invalidation level clear", result: "NOT VISIBLE" },
  { item: "30m structure aligned", result: "NOT VISIBLE" },
  { item: "Session high marked", result: "NOT VISIBLE" },
  { item: "Weekly open plotted", result: "NOT VISIBLE" },
];

const nasdaqOct22 = makeAnalysis({
  asset: "nasdaq100",
  generated_at_utc: "2026-10-22T07:06:00.000Z",
  capture: { capture_quality: "ok", notes: null },
  bias: {
    direction: "bullish",
    timeframe_agreement: "1D and 3h bullish, 30m mixed",
    rationale: null,
  },
  timeframes: [
    {
      timeframe: "1D",
      structure: "Bullish",
      levels: [
        "External range high ~24,961",
        "External range low ~24,452",
        "Equilibrium of external range ~24,706",
        "Last daily close ~24,840",
      ],
      wick_extremes: null,
      notes: "Higher lows intact; prior week's high is the draw.",
    },
    {
      timeframe: "3h",
      structure: "Bullish",
      levels: [],
      wick_extremes: null,
      notes: "Sell-side swept at the Tuesday low, then displacement up.",
    },
    {
      timeframe: "30m",
      structure: "Mixed",
      levels: [],
      wick_extremes: null,
      notes: "FVG forming in discount; lower high still above price.",
    },
  ],
  confluence: [
    { claim: "Daily and 3h structure both bullish after the sweep", timeframes: ["1D", "3h"] },
    { claim: "Displacement left a 30m fair-value gap inside discount", timeframes: ["30m"] },
    { claim: "Buy-side liquidity above 24,960 as a clear draw", timeframes: ["1D"] },
  ],
  conflicts: [{ claim: "30m shows a lower high not yet reclaimed", timeframes: ["30m"] }],
  invalidation: [{ condition: "A 3h close below 24,180 (the swept low) invalidates the long.", level: "24,180" }],
  method_citations: [
    { claim: "Daily bias is bullish", section: "methodology §2.1 bias" },
    { claim: "Sell-side liquidity was swept", section: "§3.2 liquidity sweep" },
    { claim: "Entry sits in discount", section: "§4.1 premium / discount" },
    { claim: "Grade is A+", section: "§5 grading" },
  ],
  verdict: {
    direction: "long",
    grade: "A+",
    reason: "Sell-side liquidity below Tuesday's low was taken and price displaced back into the range. Entry sits in discount with the daily bias bullish.",
    checklist: OCT22_CHECKS,
  },
  confidence: "high",
  caveats: ["US CPI print at 14:30 SAST may override structure", "Session high not visible on the 30m frame"],
});

export const recordedReportFixture: ReportResponse = report(nasdaqOct22, 22);

const poorAnalysis = makeAnalysis({
  asset: "nasdaq100",
  generated_at_utc: "2026-10-19T07:05:00.000Z",
  capture: {
    capture_quality: "poor",
    actual_timeframes: ["1D", "30m"],
    notes: "3h interval readback failed after one reselect. Only 1D and 30m were stored.",
  },
  bias: {
    direction: "bullish",
    timeframe_agreement: "Incomplete — 3h missing",
    rationale: "Daily bias stays bullish, but the 3h frame is incomplete.",
  },
  timeframes: [
    { timeframe: "1D", structure: "Bullish", levels: [], wick_extremes: null, notes: "Higher lows still intact on the daily." },
    { timeframe: "30m", structure: "Mixed", levels: [], wick_extremes: null, notes: "30m alone cannot confirm the sweep." },
  ],
  confluence: [],
  conflicts: [{ claim: "Missing 3h leaves the sweep unconfirmed", timeframes: ["3h"] }],
  invalidation: [{ condition: "Do not treat the long until the 3h frame is recaptured.", level: null }],
  method_citations: [{ claim: "Grade withheld on incomplete capture", section: "§5 grading" }],
  verdict: {
    direction: "stand_aside",
    grade: "NO TRADE",
    reason: "Held to stand aside until the missing frame is recaptured.",
    checklist: POOR_CHECKS,
  },
  confidence: "low",
  caveats: ["Capture quality is poor — judge the bias yourself."],
});

export const poorCaptureReport: ReportResponse = report(poorAnalysis, 19);

const uncitedAnalysis = makeAnalysis({
  asset: "gold",
  generated_at_utc: "2026-10-18T07:08:00.000Z",
  capture: { capture_quality: "ok", notes: null },
  bias: {
    direction: "bearish",
    timeframe_agreement: "Frames agree, citations do not",
    rationale: "Lower highs on 3h, but the model did not cite the method.",
  },
  timeframes: [
    { timeframe: "1D", structure: "Bearish", levels: [], wick_extremes: null, notes: "Daily lower high under the prior week." },
    { timeframe: "3h", structure: "Bearish", levels: [], wick_extremes: null, notes: "3h displacement down is visible." },
    { timeframe: "30m", structure: "Mixed", levels: [], wick_extremes: null, notes: "30m is still inside the breakdown candle." },
  ],
  confluence: [{ claim: "Daily and 3h both point lower", timeframes: ["1D", "3h"] }],
  conflicts: [],
  invalidation: [{ condition: "A daily close back above the breakdown high invalidates the short.", level: null }],
  method_citations: [],
  verdict: {
    direction: "short",
    grade: "B",
    reason: "Structure is bearish, but the read is ungrounded without method citations.",
    checklist: [
      { item: "Daily bias defined", result: "PASS" },
      { item: "Liquidity swept", result: "FAIL" },
      { item: "Session high marked", result: "NOT VISIBLE" },
    ],
  },
  confidence: "low",
  caveats: ["No methodology section was cited."],
});

export const uncitedReport: ReportResponse = report(uncitedAnalysis, 18);

const nasdaqOct20Analysis = makeAnalysis({
  asset: "nasdaq100",
  generated_at_utc: "2026-10-20T07:04:00.000Z",
  capture: { capture_quality: "ok", notes: null },
  bias: {
    direction: "mixed",
    timeframe_agreement: "Lower timeframes turned, daily unconfirmed",
    rationale: "Overnight high is still the reference. Daily bias is not confirmed bearish.",
  },
  timeframes: [
    { timeframe: "1D", structure: "Mixed", levels: [], wick_extremes: null, notes: "Daily still holds the overnight high." },
    { timeframe: "3h", structure: "Bearish", levels: [], wick_extremes: null, notes: "3h broke the prior session low." },
    { timeframe: "30m", structure: "Bearish", levels: [], wick_extremes: null, notes: "30m structure is lower highs." },
  ],
  confluence: [{ claim: "3h and 30m both turned bearish under the overnight high", timeframes: ["3h", "30m"] }],
  conflicts: [{ claim: "Daily bias is unconfirmed", timeframes: ["1D"] }],
  invalidation: [{ condition: "A 30m close back above the overnight high invalidates the short.", level: null }],
  method_citations: [
    { claim: "Grade held to B while higher-timeframe bias is unconfirmed", section: "§5 grading" },
    { claim: "Lower-timeframe structure turned", section: "methodology §2.1 bias" },
  ],
  verdict: {
    direction: "short",
    grade: "B",
    reason: "Lower-timeframe structure turned bearish under the overnight high, but the higher-timeframe bias is unconfirmed, so the setup is held to a B.",
    checklist: OCT20_CHECKS,
  },
  confidence: "low",
  caveats: ["Higher-timeframe bias is unconfirmed."],
});

export const nasdaqOct20Report: ReportResponse = report(nasdaqOct20Analysis, 20);

function checklistFor(date: string, asset: AssetId, index: number): Check[] {
  return CHECK_ITEMS.map((item) => {
    const roll = hash(`${date}:${asset}:${item}`) % 100;
    const nvCut = Math.round(NV_RATE[item] * 100);
    if (roll < nvCut) return { item, result: "NOT VISIBLE" as const };
    if (item === "30m structure aligned" && index % 7 === 0) return { item, result: "FAIL" as const };
    return { item, result: "PASS" as const };
  });
}

function counts(list: Check[] | undefined): AssetDay["checklist"] {
  if (!list) return undefined;
  return {
    pass: list.filter((item) => item.result === "PASS").length,
    fail: list.filter((item) => item.result === "FAIL").length,
    notVisible: list.filter((item) => item.result === "NOT VISIBLE").length,
  };
}

type Dir = "long" | "short" | "stand_aside";

function proceduralDir(date: string, asset: AssetId): Dir | "failed" {
  const n = hash(`${date}:${asset}:dir`) % 28;
  if (n === 0) return "failed";
  const d = hash(`${date}:${asset}:side`) % 10;
  if (d < 5) return "long";
  if (d < 8) return "short";
  return "stand_aside";
}

function assetOf(date: string, asset: AssetId, dir: Dir | "failed", extra?: Partial<DemoAsset>, index = 0): DemoAsset {
  if (dir === "failed") {
    return {
      ok: false,
      error: extra?.error ?? "Capture failed before a report was written.",
      step: extra?.step ?? `capture-${asset}`,
    };
  }
  const grade = extra?.grade ?? (dir === "stand_aside" ? "NO TRADE" : hash(`${date}:${asset}:grade`) % 5 === 0 ? "A+" : "B");
  const confidence = extra?.confidence ?? (hash(`${date}:${asset}:conf`) % 3 === 0 ? "high" : hash(`${date}:${asset}:conf`) % 3 === 1 ? "low" : "medium");
  return {
    ok: true,
    direction: dir,
    grade,
    confidence,
    captureQuality: extra?.captureQuality ?? "ok",
    reason: extra?.reason,
    checklist: extra?.checklist ?? checklistFor(date, asset, index),
    generatedAt: extra?.generatedAt ?? `${date}T07:0${(hash(date) % 6) + 2}:00.000Z`,
    report: extra?.report,
  };
}

const CAPTURE_ERROR = "Interval readback mismatch on 3h after one reselect; 30m already stored, no fallback. 1 of 3 frames captured.";

const OCTOBER: Record<string, { n: Dir | "failed"; g: Dir | "failed"; nExtra?: Partial<DemoAsset>; gExtra?: Partial<DemoAsset> }> = {
  "2026-10-01": { n: "long", g: "short" },
  "2026-10-02": { n: "short", g: "stand_aside" },
  "2026-10-05": { n: "long", g: "long" },
  "2026-10-06": { n: "stand_aside", g: "long" },
  "2026-10-07": { n: "long", g: "stand_aside" },
  "2026-10-08": { n: "short", g: "short", nExtra: { grade: "A+" } },
  "2026-10-09": { n: "long", g: "stand_aside" },
  "2026-10-12": { n: "stand_aside", g: "long" },
  "2026-10-13": { n: "long", g: "short", nExtra: { grade: "A+" } },
  "2026-10-14": { n: "short", g: "stand_aside" },
  "2026-10-15": {
    n: "failed",
    g: "failed",
    nExtra: { error: "Both frames failed interval readback. No fallback stored.", step: "capture-nasdaq100" },
    gExtra: { error: "Both frames failed interval readback. No fallback stored.", step: "capture-gold" },
  },
  "2026-10-16": {
    n: "long",
    g: "long",
    nExtra: { grade: "B", confidence: "medium" },
    gExtra: { grade: "B", confidence: "high" },
  },
  "2026-10-19": {
    n: "stand_aside",
    g: "long",
    nExtra: {
      grade: "NO TRADE",
      confidence: "low",
      captureQuality: "poor",
      checklist: POOR_CHECKS,
      reason: poorAnalysis.verdict.reason ?? undefined,
      generatedAt: "2026-10-19T07:05:00.000Z",
      report: poorCaptureReport,
    },
    gExtra: { grade: "A+", confidence: "high" },
  },
  "2026-10-20": {
    n: "short",
    g: "failed",
    nExtra: {
      grade: "B",
      confidence: "low",
      checklist: OCT20_CHECKS,
      reason: nasdaqOct20Analysis.verdict.reason ?? undefined,
      generatedAt: "2026-10-20T07:04:00.000Z",
      report: nasdaqOct20Report,
    },
    gExtra: { error: CAPTURE_ERROR, step: "capture-gold" },
  },
  "2026-10-21": {
    n: "long",
    g: "short",
    nExtra: { grade: "B", confidence: "medium" },
    gExtra: { grade: "B", confidence: "medium" },
  },
  "2026-10-22": {
    n: "long",
    g: "stand_aside",
    nExtra: {
      grade: "A+",
      confidence: "high",
      checklist: OCT22_CHECKS,
      reason: nasdaqOct22.verdict.reason ?? undefined,
      generatedAt: "2026-10-22T07:06:00.000Z",
      report: recordedReportFixture,
    },
    gExtra: { grade: "NO TRADE", confidence: "medium" },
  },
};

const SEPTEMBER: Record<string, { n: Dir | "failed"; g: Dir | "failed"; nExtra?: Partial<DemoAsset> }> = {
  "2026-09-24": { n: "short", g: "long", nExtra: { grade: "B" } },
  "2026-09-25": { n: "short", g: "stand_aside", nExtra: { grade: "B" } },
  "2026-09-28": { n: "stand_aside", g: "long" },
  "2026-09-29": { n: "long", g: "short", nExtra: { grade: "A+" } },
  "2026-09-30": { n: "long", g: "long", nExtra: { grade: "B" } },
};

function statusOf(left: DemoAsset, right: DemoAsset): DaySummary["status"] {
  if (left.ok && right.ok) return "ok";
  if (!left.ok && !right.ok) return "failed";
  return "partial";
}

function buildDay(date: string, index: number): DemoDay {
  const hand = OCTOBER[date] ?? SEPTEMBER[date];
  const nasdaq100 = hand
    ? assetOf(date, "nasdaq100", hand.n, hand.nExtra, index)
    : assetOf(date, "nasdaq100", proceduralDir(date, "nasdaq100"), undefined, index);
  const gold = hand
    ? assetOf(date, "gold", hand.g, "gExtra" in hand ? hand.gExtra : undefined, index)
    : assetOf(date, "gold", proceduralDir(date, "gold"), undefined, index);
  return {
    date,
    executionName: `cron-${date}`,
    status: statusOf(nasdaq100, gold),
    nasdaq100,
    gold,
  };
}

export const demoDays: DemoDay[] = eachWeekday("2026-01-02", "2026-10-22")
  .map((date, index) => buildDay(date, index))
  .reverse();

const dayIndex = new Map(demoDays.map((day) => [day.date, day]));

export function demoDay(date: string): DemoDay | undefined {
  return dayIndex.get(date);
}

export function toSummary(day: DemoDay): DaySummary {
  const asset = (spec: DemoAsset): AssetDay => ({
    ok: spec.ok,
    direction: spec.direction,
    grade: spec.grade,
    confidence: spec.confidence,
    captureQuality: spec.captureQuality,
    checklist: counts(spec.checklist),
    error: spec.error,
  });
  return daySummarySchema.parse({
    date: day.date,
    status: day.status,
    executionName: day.executionName,
    assets: { nasdaq100: asset(day.nasdaq100), gold: asset(day.gold) },
  });
}

function framesFor(direction: Dir): ChartAnalysis["timeframes"] {
  const word = direction === "long" ? "Bullish" : direction === "short" ? "Bearish" : "Mixed";
  return [
    { timeframe: "1D", structure: word, levels: [], wick_extremes: null, notes: "Daily structure from the captured frame." },
    { timeframe: "3h", structure: word, levels: [], wick_extremes: null, notes: "3h agrees with the session read." },
    { timeframe: "30m", structure: "Mixed", levels: [], wick_extremes: null, notes: "30m does not add a fresh confirmation." },
  ];
}

export function reportFor(date: string, asset: AssetId): ReportResponse | null {
  const day = dayIndex.get(date);
  if (!day) return null;
  const spec = day[asset];
  if (!spec.ok || !spec.direction || !spec.grade) return null;
  if (spec.report) return spec.report;
  const analysis = makeAnalysis({
    asset,
    generated_at_utc: spec.generatedAt ?? `${date}T07:04:00.000Z`,
    capture: { capture_quality: spec.captureQuality ?? "ok", notes: spec.captureQuality === "poor" ? "Capture quality is poor." : null },
    bias: {
      direction: spec.direction === "long" ? "bullish" : spec.direction === "short" ? "bearish" : "neutral",
      timeframe_agreement: null,
      rationale: spec.reason ?? null,
    },
    timeframes: framesFor(spec.direction),
    confluence: spec.reason ? [{ claim: spec.reason, timeframes: ["1D"] }] : [],
    conflicts: [],
    invalidation: [],
    method_citations: [{ claim: "Grade follows the visible structure", section: "§5 grading" }],
    verdict: {
      direction: spec.direction,
      grade: spec.grade,
      reason: spec.reason ?? `${assetLabelSafe(asset)} ${spec.direction.replace("_", " ")} on the captured frames.`,
      checklist: spec.checklist ?? [],
    },
    confidence: spec.confidence ?? "medium",
    caveats: [],
  });
  return report(analysis, hash(`${date}:${asset}`) % 90);
}

function assetLabelSafe(asset: string): string {
  return asset === "nasdaq100" ? "Nasdaq 100" : "Gold";
}

export const oct20Runs: RunsResponse = {
  date: "2026-10-20",
  executionName: "cron-2026-10-20",
  startedAt: "2026-10-20T07:00:02.000Z",
  finishedAt: "2026-10-20T07:06:41.000Z",
  runs: [
    {
      asset: "nasdaq100",
      ok: true,
      startedAt: "2026-10-20T07:00:02.000Z",
      finishedAt: "2026-10-20T07:06:41.000Z",
      durationMs: 399000,
      promptTokens: 18420,
      completionTokens: 3210,
      cachedTokens: 16946,
      uncachedTokens: 1474,
      finishReason: "stop",
      errors: [],
      framesVerified: "3/3",
      steps: [
        { name: "capture-nasdaq100", durationMs: 92000, outcome: "ok", note: "3/3 frames verified" },
        { name: "analyse-prepare-nasdaq100", durationMs: 1000, outcome: "ok" },
        { name: "analyse-chat-nasdaq100", durationMs: 168000, outcome: "retried", note: "1 retry on 429, 30 s backoff" },
        { name: "analyse-parse-nasdaq100", durationMs: 2000, outcome: "ok" },
        { name: "brief-nasdaq100", durationMs: 1000, outcome: "ok" },
        { name: "notify-morning", durationMs: 1000, outcome: "ok" },
      ],
    },
    {
      asset: "gold",
      ok: false,
      startedAt: "2026-10-20T07:00:08.000Z",
      finishedAt: "2026-10-20T07:04:11.000Z",
      durationMs: 243000,
      promptTokens: null,
      completionTokens: null,
      cachedTokens: null,
      uncachedTokens: null,
      finishReason: null,
      errors: [CAPTURE_ERROR],
      framesVerified: "1/3",
      steps: [
        { name: "capture-gold", durationMs: 74000, outcome: "failed", note: "1/3 frames captured" },
        { name: "notify-morning", durationMs: 1000, outcome: "ok", note: "marked no brief" },
      ],
    },
  ],
};

export const demoExecutions = [
  { name: "cron-2026-10-22", status: "Succeeded", startedAt: "2026-10-22T07:00:00.000Z", endedAt: "2026-10-22T07:06:12.000Z", durationMs: 372000 },
  { name: "cron-2026-10-21", status: "Succeeded", startedAt: "2026-10-21T07:00:00.000Z", endedAt: "2026-10-21T07:05:48.000Z", durationMs: 348000 },
  { name: "run-2026-10-20-1792491", status: "Succeeded", startedAt: "2026-10-20T10:14:00.000Z", endedAt: "2026-10-20T10:20:10.000Z", durationMs: 370000 },
  { name: "cron-2026-10-20", status: "Partial", startedAt: "2026-10-20T07:00:00.000Z", endedAt: "2026-10-20T07:06:39.000Z", durationMs: 399000 },
  { name: "cron-2026-10-19", status: "Succeeded", startedAt: "2026-10-19T07:00:00.000Z", endedAt: "2026-10-19T07:05:55.000Z", durationMs: 355000 },
];
