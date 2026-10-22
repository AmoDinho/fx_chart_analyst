import type { ChartAnalysis } from "@fx/core/analysis/schema";
import type { AssetDay, DaySummary } from "@fx/core/api";
import type { Asset } from "@fx/core/capture/config";
import {
	type FailItem,
	type ReportItem,
	type RunItem,
	type SummaryItem,
	dayPk,
	failSk,
	reportSk,
	rollupStatus,
	runSk,
	summaryItem,
} from "./items";
import type { DocClient, IndexItem } from "./types";

export class AnalysisRepo {
	constructor(private readonly docs: DocClient) {}

	async getSummary(date: string): Promise<SummaryItem | null> {
		const item = await this.docs.get(dayPk(date), "SUMMARY");
		return item ? (item as SummaryItem) : null;
	}

	async getReport(date: string, asset: Asset): Promise<ReportItem | null> {
		const item = await this.docs.get(dayPk(date), reportSk(asset));
		return item ? (item as ReportItem) : null;
	}

	async putReport(item: ReportItem): Promise<void> {
		await this.docs.put(item);
	}

	async putRun(item: RunItem): Promise<void> {
		await this.docs.put(item);
	}

	async putFail(item: FailItem): Promise<void> {
		await this.docs.put(item);
	}

	async dayItems(date: string): Promise<IndexItem[]> {
		const page = await this.docs.query({ pk: dayPk(date), forward: true });
		return page.items;
	}

	async listDays(limit: number, cursor?: string | null): Promise<{ items: SummaryItem[]; cursor: string | null }> {
		const page = await this.docs.query({
			index: "gsi1",
			pk: "DAYS",
			forward: false,
			limit,
			cursor,
		});
		return { items: page.items as SummaryItem[], cursor: page.cursor };
	}

	async history(asset: Asset, from: string, to: string): Promise<ReportItem[]> {
		const page = await this.docs.query({
			index: "gsi2",
			pk: `ASSET#${asset}`,
			skFrom: from,
			skTo: to,
			forward: true,
		});
		return page.items as ReportItem[];
	}

	async updateSummary(input: {
		date: string;
		executionName: string;
		asset?: Asset;
		slice?: AssetDay;
		running?: boolean;
		status?: DaySummary["status"];
	}): Promise<SummaryItem> {
		const current = await this.getSummary(input.date);
		const assets = { ...(current?.assets ?? {}) };
		if (input.asset && input.slice) assets[input.asset] = input.slice;
		const next = summaryItem({
			date: input.date,
			executionName: input.executionName || current?.executionName || "",
			assets,
			running: input.running,
			status: input.status,
		});
		if (!input.status && !input.running) next.status = rollupStatus(assets, { running: input.running });
		await this.docs.put(next);
		return next;
	}

	async finishDay(date: string, executionName: string): Promise<SummaryItem> {
		const current = await this.getSummary(date);
		const assets = current?.assets ?? {};
		const next = summaryItem({
			date,
			executionName: executionName || current?.executionName || "",
			assets,
			status: rollupStatus(assets),
		});
		await this.docs.put(next);
		return next;
	}
}

export function reportItem(input: {
	date: string;
	asset: Asset;
	analysis: ChartAnalysis;
	charts: ReportItem["charts"];
	markdownKey: string;
	briefKey: string;
}): ReportItem {
	return {
		pk: dayPk(input.date),
		sk: reportSk(input.asset),
		gsi2pk: `ASSET#${input.asset}`,
		gsi2sk: input.date,
		asset: input.asset,
		date: input.date,
		analysis: input.analysis,
		charts: input.charts,
		markdownKey: input.markdownKey,
		briefKey: input.briefKey,
	};
}

export function emptyRun(asset: Asset, date: string): RunItem {
	return {
		pk: dayPk(date),
		sk: runSk(asset),
		asset,
		ok: false,
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		promptTokens: null,
		completionTokens: null,
		cachedTokens: null,
		uncachedTokens: null,
		finishReason: null,
		errors: [],
		steps: [],
		framesVerified: null,
	};
}

export function failItem(date: string, asset: Asset, error: string, step?: string): FailItem {
	return {
		pk: dayPk(date),
		sk: failSk(asset),
		gsi2pk: `ASSET#${asset}`,
		gsi2sk: date,
		asset,
		error,
		step,
	};
}
