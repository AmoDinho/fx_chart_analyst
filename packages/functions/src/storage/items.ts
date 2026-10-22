import type { ChartAnalysis } from "@fx/core/analysis/schema";
import type { AssetDay, DaySummary } from "@fx/core/api";
import { ASSETS, type assetSchema } from "@fx/core/api";
import type { Asset } from "@fx/core/capture/config";
import type { z } from "zod";

type AssetName = z.infer<typeof assetSchema>;

export type ReportItem = {
	pk: string;
	sk: string;
	gsi2pk: string;
	gsi2sk: string;
	asset: AssetName;
	date: string;
	analysis: ChartAnalysis;
	charts: { timeframe: string; key: string; width: number; height: number }[];
	markdownKey: string;
	briefKey: string;
};

export type RunStepRecord = {
	name: string;
	durationMs: number;
	outcome: "ok" | "retried" | "failed";
	note?: string;
};

export type RunItem = {
	pk: string;
	sk: string;
	asset: AssetName;
	ok: boolean;
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
	promptTokens: number | null;
	completionTokens: number | null;
	cachedTokens: number | null;
	uncachedTokens: number | null;
	finishReason: string | null;
	errors: string[];
	steps: RunStepRecord[];
	framesVerified: string | null;
};

export type FailItem = {
	pk: string;
	sk: string;
	gsi2pk: string;
	gsi2sk: string;
	asset: AssetName;
	error: string;
	step?: string;
};

export type SummaryItem = {
	pk: string;
	sk: "SUMMARY";
	gsi1pk: "DAYS";
	gsi1sk: string;
	date: string;
	status: DaySummary["status"];
	executionName: string;
	assets: Partial<Record<AssetName, AssetDay>>;
};

export function dayPk(date: string): string {
	return `DAY#${date}`;
}

export function reportSk(asset: string): string {
	return `REPORT#${asset}`;
}

export function runSk(asset: string): string {
	return `RUN#${asset}`;
}

export function failSk(asset: string): string {
	return `FAIL#${asset}`;
}

export function checklistCounts(analysis: ChartAnalysis): { pass: number; fail: number; notVisible: number } {
	const counts = { pass: 0, fail: 0, notVisible: 0 };
	for (const item of analysis.verdict.checklist) {
		if (item.result === "PASS") counts.pass += 1;
		else if (item.result === "FAIL") counts.fail += 1;
		else counts.notVisible += 1;
	}
	return counts;
}

export function assetSliceFromAnalysis(analysis: ChartAnalysis): AssetDay {
	return {
		ok: true,
		direction: analysis.verdict.direction,
		grade: analysis.verdict.grade,
		confidence: analysis.confidence,
		captureQuality: analysis.capture.capture_quality,
		checklist: checklistCounts(analysis),
	};
}

export function rollupStatus(
	assets: Partial<Record<AssetName, AssetDay>>,
	opts?: { running?: boolean },
): DaySummary["status"] {
	const present = ASSETS.map((asset) => assets[asset]).filter((item): item is AssetDay => Boolean(item));
	if (present.length === 0) return opts?.running ? "running" : "failed";
	const ok = present.filter((item) => item.ok).length;
	const failed = present.length - ok;
	if (present.length < ASSETS.length) {
		if (opts?.running && failed === 0) return "running";
		if (ok && failed) return "partial";
		if (failed && !ok) return present.length === ASSETS.length ? "failed" : opts?.running ? "running" : "partial";
		return opts?.running ? "running" : "partial";
	}
	if (ok && failed) return "partial";
	if (failed) return "failed";
	return "ok";
}

export function summaryItem(input: {
	date: string;
	executionName: string;
	assets: Partial<Record<AssetName, AssetDay>>;
	running?: boolean;
	status?: DaySummary["status"];
}): SummaryItem {
	return {
		pk: dayPk(input.date),
		sk: "SUMMARY",
		gsi1pk: "DAYS",
		gsi1sk: input.date,
		date: input.date,
		executionName: input.executionName,
		assets: input.assets,
		status: input.status ?? rollupStatus(input.assets, { running: input.running }),
	};
}

export function isAssetName(value: string): value is Asset {
	return value === "nasdaq100" || value === "gold";
}

export function redactRun(item: RunItem) {
	return {
		asset: item.asset,
		ok: item.ok,
		startedAt: item.startedAt,
		finishedAt: item.finishedAt,
		durationMs: item.durationMs,
		promptTokens: item.promptTokens,
		completionTokens: item.completionTokens,
		cachedTokens: item.cachedTokens,
		uncachedTokens: item.uncachedTokens,
		finishReason: item.finishReason,
		errors: item.errors,
		steps: item.steps,
		framesVerified: item.framesVerified,
	};
}
