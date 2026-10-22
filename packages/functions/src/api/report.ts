import { reportResponseSchema } from "@fx/core/api";
import type { HttpEvent } from "../http";
import { isResult, json, readAsset, readDate } from "../http";
import { apiContext, chartLinks } from "./context";

export async function handler(event: HttpEvent) {
	const date = readDate(event.pathParameters?.date);
	if (isResult(date)) return date;
	const asset = readAsset(event.pathParameters?.asset);
	if (isResult(asset)) return asset;
	const { repo, objects } = await apiContext();
	const item = await repo.getReport(date, asset);
	if (!item) return json(404, { error: "report not found" });
	const charts = await chartLinks(objects, item.charts);
	const briefUrl = item.briefKey ? await objects.presignGet(item.briefKey) : undefined;
	return json(200, reportResponseSchema.parse({ analysis: item.analysis, charts, briefUrl }));
}
