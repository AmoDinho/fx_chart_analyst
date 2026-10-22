import {
  adminRunBodySchema,
  adminStartResponseSchema,
  dayDetailSchema,
  daysResponseSchema,
  historyResponseSchema,
  reportResponseSchema,
  runsResponseSchema,
  screenshotReadySchema,
  screenshotStartSchema,
  statusResponseSchema,
  type DayDetail,
  type DaysResponse,
  type HistoryResponse,
  type ReportResponse,
  type RunsResponse,
} from "@fx/core/api";
import { executionName } from "@fx/core/workflow-params";
import type { Asset } from "@fx/core/capture/config";
import {
  demoDay,
  demoDays,
  demoExecutions,
  oct20Runs,
  reportFor,
  sparklineUrl,
  toSummary,
  type AssetId,
  type DemoDay,
} from "./fixtures";
import { publicConfig } from "./config";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type AdminRunBody = {
  date?: string;
  asset?: Asset;
  force?: boolean;
};

export type AdminStart = { executionName: string; created: boolean };
export type ScreenshotBody = { asset: Asset; timeframe: string };
export type ScreenshotStart = { id: string };
export type ScreenshotReady = { id: string; ready: boolean; url?: string };
export type StatusResponse = {
  executions: Array<{
    name: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  }>;
};

export type Api = {
  listDays(params?: { limit?: number; cursor?: string }): Promise<DaysResponse>;
  getDay(date: string): Promise<DayDetail>;
  getReport(asset: string, date: string): Promise<ReportResponse>;
  getMarkdown(asset: string, date: string): Promise<string>;
  getHistory(asset: string, from: string, to: string): Promise<HistoryResponse>;
  getRuns(date: string): Promise<RunsResponse>;
  startRun(body: AdminRunBody): Promise<AdminStart>;
  startAnalyse(body: AdminRunBody): Promise<AdminStart>;
  startScreenshot(body: ScreenshotBody): Promise<ScreenshotStart>;
  getScreenshot(id: string): Promise<ScreenshotReady>;
  getStatus(): Promise<StatusResponse>;
};

function isAsset(value: string): value is AssetId {
  return value === "nasdaq100" || value === "gold";
}

function dayDetail(day: DemoDay): DayDetail {
  const failure = (asset: AssetId) => {
    const spec = day[asset];
    if (spec.ok) return [];
    return [{ asset, error: spec.error ?? "Capture failed", step: spec.step }];
  };
  return dayDetailSchema.parse({
    summary: toSummary(day),
    reports: {
      nasdaq100: day.nasdaq100.ok ? reportFor(day.date, "nasdaq100") : null,
      gold: day.gold.ok ? reportFor(day.date, "gold") : null,
    },
    failures: [...failure("nasdaq100"), ...failure("gold")],
  });
}

function historyRows(asset: AssetId, from: string, to: string) {
  return demoDays
    .filter((day) => day.date >= from && day.date <= to)
    .map((day) => {
      const spec = day[asset];
      return {
        date: day.date,
        ok: spec.ok,
        direction: spec.direction,
        grade: spec.grade,
        captureQuality: spec.captureQuality,
        checklist: spec.checklist,
        error: spec.error,
      };
    })
    .reverse();
}

function synthesizeRuns(day: DemoDay): RunsResponse {
  const startedAt = `${day.date}T07:00:02.000Z`;
  const finishedAt = `${day.date}T07:06:18.000Z`;
  return runsResponseSchema.parse({
    date: day.date,
    executionName: day.executionName,
    startedAt,
    finishedAt,
    runs: (["nasdaq100", "gold"] as const).map((asset) => {
      const spec = day[asset];
      if (!spec.ok) {
        return {
          asset,
          ok: false,
          startedAt,
          finishedAt,
          durationMs: 180000,
          promptTokens: null,
          completionTokens: null,
          cachedTokens: null,
          uncachedTokens: null,
          finishReason: null,
          errors: [spec.error ?? "Capture failed"],
          framesVerified: "0/3",
          steps: [{ name: spec.step ?? `capture-${asset}`, durationMs: 64000, outcome: "failed" as const, note: spec.error }],
        };
      }
      const prompt = 14000 + (day.date.charCodeAt(9) % 7) * 800;
      const cached = Math.round(prompt * 0.9);
      return {
        asset,
        ok: true,
        startedAt,
        finishedAt,
        durationMs: 360000,
        promptTokens: prompt,
        completionTokens: 2800,
        cachedTokens: cached,
        uncachedTokens: prompt - cached,
        finishReason: "stop",
        errors: [],
        framesVerified: "3/3",
        steps: [
          { name: `capture-${asset}`, durationMs: 80000, outcome: "ok" as const, note: "3/3 frames verified" },
          { name: `analyse-chat-${asset}`, durationMs: 140000, outcome: "ok" as const },
          { name: `brief-${asset}`, durationMs: 1000, outcome: "ok" as const },
        ],
      };
    }),
  });
}

export function createDemoApi(): Api {
  const executions: StatusResponse["executions"] = demoExecutions.map((row) => ({ ...row }));
  const shots = new Map<string, { polls: number; asset: Asset; timeframe: string }>();

  function start(phase: "full" | "analyse", body: AdminRunBody): AdminStart {
    const parsed = adminRunBodySchema.parse(body);
    const date = parsed.date ?? new Date().toISOString().slice(0, 10);
    const assets: Asset[] = parsed.asset ? [parsed.asset] : ["nasdaq100", "gold"];
    const name = executionName({
      date,
      force: parsed.force === true,
      phase,
      assets,
      now: parsed.force ? Date.now() : undefined,
    });
    executions.unshift({
      name,
      status: "Running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
    });
    return adminStartResponseSchema.parse({ executionName: name, created: true });
  }

  return {
    async listDays(params) {
      const limit = params?.limit ?? 30;
      const startAt = params?.cursor ? demoDays.findIndex((day) => day.date === params.cursor) + 1 : 0;
      const slice = demoDays.slice(Math.max(0, startAt), Math.max(0, startAt) + limit);
      const next = startAt + limit < demoDays.length ? slice[slice.length - 1]?.date ?? null : null;
      return daysResponseSchema.parse({ days: slice.map(toSummary), nextCursor: next });
    },
    async getDay(date) {
      const day = demoDay(date);
      if (!day) throw new ApiError(404, "No run recorded for this date");
      return dayDetail(day);
    },
    async getReport(asset, date) {
      if (!isAsset(asset)) throw new ApiError(400, "Unknown asset");
      const found = reportFor(date, asset);
      if (!found) throw new ApiError(404, "No report for this asset on this date");
      return reportResponseSchema.parse(found);
    },
    async getMarkdown(asset, date) {
      if (!isAsset(asset)) throw new ApiError(400, "Unknown asset");
      const found = reportFor(date, asset);
      if (!found?.markdown) throw new ApiError(404, "No markdown for this report");
      return found.markdown;
    },
    async getHistory(asset, from, to) {
      if (!isAsset(asset)) throw new ApiError(400, "Unknown asset");
      return historyResponseSchema.parse({ asset, from, to, rows: historyRows(asset, from, to) });
    },
    async getRuns(date) {
      if (date === "2026-10-20") return runsResponseSchema.parse(oct20Runs);
      const day = demoDay(date);
      if (!day) throw new ApiError(404, "No run log for this date");
      return synthesizeRuns(day);
    },
    async startRun(body) {
      return start("full", body);
    },
    async startAnalyse(body) {
      return start("analyse", body);
    },
    async startScreenshot(body) {
      const id = `shot-${body.asset}-${body.timeframe}-${shots.size + 1}`;
      shots.set(id, { polls: 0, asset: body.asset, timeframe: body.timeframe });
      return screenshotStartSchema.parse({ id });
    },
    async getScreenshot(id) {
      const shot = shots.get(id);
      if (!shot) return screenshotReadySchema.parse({ id, ready: false });
      shot.polls += 1;
      if (shot.polls < 2) return screenshotReadySchema.parse({ id, ready: false });
      return screenshotReadySchema.parse({
        id,
        ready: true,
        url: sparklineUrl(shot.asset === "gold" ? 7 : 3, 1200, 675),
      });
    },
    async getStatus() {
      return statusResponseSchema.parse({ executions });
    },
  };
}

type Schema<T> = { parse: (data: unknown) => T };

async function send<T>(base: string, getToken: () => Promise<string | null>, path: string, schema: Schema<T>, init?: RequestInit): Promise<T> {
  const token = await getToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${path}`);
  return schema.parse(await res.json());
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function createHttpApi(baseUrl: string, getToken: () => Promise<string | null>): Api {
  const base = baseUrl.replace(/\/$/, "");
  return {
    listDays: (params) => send(base, getToken, `/days${qs({ limit: params?.limit ?? 30, cursor: params?.cursor })}`, daysResponseSchema),
    getDay: (date) => send(base, getToken, `/days/${seg(date)}`, dayDetailSchema),
    getReport: (asset, date) => send(base, getToken, `/reports/${seg(asset)}/${seg(date)}`, reportResponseSchema),
    async getMarkdown(asset, date) {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Not signed in");
      const res = await fetch(`${base}/reports/${seg(asset)}/${seg(date)}/markdown`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/markdown, application/json, text/plain" },
      });
      if (!res.ok) throw new ApiError(res.status, `${res.status} markdown`);
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("json")) {
        const body: unknown = await res.json();
        if (typeof body === "string") return body;
        if (body && typeof body === "object" && "markdown" in body && typeof body.markdown === "string") return body.markdown;
        return JSON.stringify(body, null, 2);
      }
      return res.text();
    },
    getHistory: (asset, from, to) => send(base, getToken, `/assets/${seg(asset)}/history${qs({ from, to })}`, historyResponseSchema),
    getRuns: (date) => send(base, getToken, `/runs/${seg(date)}`, runsResponseSchema),
    startRun: (body) =>
      send(base, getToken, "/admin/run", adminStartResponseSchema, { method: "POST", body: JSON.stringify(adminRunBodySchema.parse(body)) }),
    startAnalyse: (body) =>
      send(base, getToken, "/admin/analyse", adminStartResponseSchema, {
        method: "POST",
        body: JSON.stringify(adminRunBodySchema.parse(body)),
      }),
    startScreenshot: (body) =>
      send(base, getToken, "/admin/screenshot", screenshotStartSchema, { method: "POST", body: JSON.stringify(body) }),
    getScreenshot: (id) => send(base, getToken, `/admin/screenshot/${seg(id)}`, screenshotReadySchema),
    getStatus: () => send(base, getToken, "/admin/status", statusResponseSchema),
  };
}

export function createApi(getToken: () => Promise<string | null>): Api {
  const base = publicConfig().apiUrl;
  if (!base) return createDemoApi();
  return createHttpApi(base, getToken);
}
