import type { Asset } from "@fx/core/capture/config";
import { isUtcDate, utcDate } from "@fx/core/capture/config";
import { executionName, type DailyPhase } from "@fx/core/workflow-params";
import type { DaySummary } from "@fx/core/api";

export const ASSET_LABEL: Record<string, string> = {
  nasdaq100: "Nasdaq 100",
  gold: "Gold",
};

export type RangeKey = "1M" | "3M" | "6M" | "YTD";
export type AssetChoice = "both" | Asset;

export function assetLabel(asset: string): string {
  return ASSET_LABEL[asset] ?? asset;
}

export function directionLabel(direction: string): string {
  if (direction === "long") return "Long";
  if (direction === "short") return "Short";
  if (direction === "stand_aside") return "Stand aside";
  return direction;
}

export function directionArrow(direction: string): string {
  if (direction === "long") return "↑";
  if (direction === "short") return "↓";
  if (direction === "stand_aside") return "–";
  return "·";
}

export function biasLabel(direction: string): string {
  if (direction === "up" || direction === "bullish") return "Bullish";
  if (direction === "down" || direction === "bearish") return "Bearish";
  if (direction === "mixed") return "Mixed";
  if (direction === "neutral") return "Neutral";
  if (direction === "unclear") return "Unclear";
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}

export function biasClass(direction: string): string {
  return `tone-${biasTone(direction)}`;
}

export function biasTone(direction: string): "long" | "short" | "stand" {
  const value = direction.toLowerCase();
  if (value === "up" || value === "bullish" || value === "long") return "long";
  if (value === "down" || value === "bearish" || value === "short") return "short";
  return "stand";
}

export function dayStatusLabel(status: DaySummary["status"]): string {
  if (status === "ok") return "Complete";
  if (status === "partial") return "Partial";
  if (status === "failed") return "Failed";
  return "Running";
}

export function gradeShort(grade: string): string {
  if (grade === "NO TRADE") return "NT";
  return grade;
}

export function confidenceLabel(confidence: string, compact = false): string {
  if (compact && confidence === "medium") return "med";
  return confidence;
}

export function todayUtc(now = new Date()): string {
  return utcDate(now);
}

export function todaySast(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftWeekday(iso: string, dir: -1 | 1): string {
  let cursor = iso;
  do {
    cursor = addDays(cursor, dir);
  } while (new Date(`${cursor}T00:00:00.000Z`).getUTCDay() % 6 === 0);
  return cursor;
}

export function eachWeekday(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    const dow = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function clean(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, " ");
}

function zoned(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return clean(new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(new Date(iso)));
}

export function formatDay(iso: string, withYear = false): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const weekday = clean(new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date));
  const day = clean(new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" }).format(date));
  const month = clean(new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date));
  if (!withYear) return `${weekday} ${day} ${month}`;
  const year = clean(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" }).format(date));
  return `${weekday} ${day} ${month} ${year}`;
}

export function formatDayShort(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const day = clean(new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" }).format(date));
  const month = clean(new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date));
  return `${day} ${month}`;
}

export function formatMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = clean(new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(date));
  return `${name} ${year}`;
}

export function formatSpan(from: string, to: string): string {
  return `${formatDayShort(from)} – ${formatDayShort(to)}`;
}

export function formatHmUtc(iso: string): string {
  return zoned(iso, "UTC", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatHmsUtc(iso: string): string {
  return zoned(iso, "UTC", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

export function formatSastClock(iso: string): string {
  return `${zoned(iso, "Africa/Johannesburg", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} SAST`;
}

export function formatExecWhen(iso: string, today = todayUtc()): string {
  const hm = formatHmUtc(iso);
  if (iso.slice(0, 10) === today) return `Today ${hm} UTC`;
  const weekday = zoned(iso, "UTC", { weekday: "short" });
  return `${weekday} ${hm} UTC`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes} m ${seconds} s` : `${minutes} m`;
}

export function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export type CalCell = { date: string; day: number } | null;

export function monthCells(year: number, month: number): CalCell[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = startDow === 0 || startDow === 6 ? 0 : startDow - 1;
  const cells: CalCell[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= last; day += 1) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day });
  }
  return cells;
}

export function rangeFor(key: RangeKey, today = todayUtc()): { from: string; to: string } {
  if (key === "YTD") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const days = key === "1M" ? 28 : key === "3M" ? 91 : 182;
  return { from: addDays(today, -days), to: today };
}

export function previewExecutionName(input: {
  date: string;
  asset: AssetChoice;
  force: boolean;
  phase: DailyPhase;
}): string {
  if (!isUtcDate(input.date)) return "—";
  if (input.force) return `run-${input.date}-…`;
  const assets: Asset[] = input.asset === "both" ? ["nasdaq100", "gold"] : [input.asset];
  return executionName({ date: input.date, force: false, phase: input.phase, assets });
}

export function isAssetId(value: string): value is Asset {
  return value === "nasdaq100" || value === "gold";
}
