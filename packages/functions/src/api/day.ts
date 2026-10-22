import { ASSETS, dayDetailSchema, type DaySummary } from "@fx/core/api";
import type { HttpEvent } from "../http";
import { isResult, json, readDate } from "../http";
import { type FailItem, type ReportItem, type SummaryItem } from "../storage/items";
import { apiContext, chartLinks } from "./context";

export async function handler(event: HttpEvent) {
	const date = readDate(event.pathParameters?.date);
	if (isResult(date)) return date;
	const { repo, objects } = await apiContext();
	const items = await repo.dayItems(date);
	const summary = items.find((item) => item.sk === "SUMMARY") as SummaryItem | undefined;
	if (!summary) return json(404, { error: "day not found" });
	const reports = {
		nasdaq100: await reportOrNull(objects, items.find((item) => item.sk === "REPORT#nasdaq100") as ReportItem | undefined),
		gold: await reportOrNull(objects, items.find((item) => item.sk === "REPORT#gold") as ReportItem | undefined),
	};
	const failures = items
		.filter((item) => String(item.sk).startsWith("FAIL#"))
		.map((item) => {
			const fail = item as FailItem;
			return { asset: fail.asset, error: fail.error, step: fail.step };
		});
	const body = dayDetailSchema.parse({
		summary: toSummary(summary),
		reports,
		failures,
	});
	return json(200, body);
}

async function reportOrNull(
	objects: Parameters<typeof chartLinks>[0],
	item: ReportItem | undefined,
) {
	if (!item) return null;
	const charts = await chartLinks(objects, item.charts);
	const briefUrl = item.briefKey ? await objects.presignGet(item.briefKey) : undefined;
	return { analysis: item.analysis, charts, briefUrl };
}

function toSummary(item: SummaryItem): DaySummary {
	const assets: DaySummary["assets"] = {};
	for (const asset of ASSETS) {
		if (item.assets?.[asset]) assets[asset] = item.assets[asset];
	}
	return {
		date: item.date,
		status: item.status,
		executionName: item.executionName,
		assets,
	};
}
