import { markdownResponseSchema } from "@fx/core/api";
import { renderReport } from "@fx/core/report/render";
import type { HttpEvent } from "../http";
import { isResult, json, readAsset, readDate } from "../http";
import { apiContext } from "./context";

export async function handler(event: HttpEvent) {
	const date = readDate(event.pathParameters?.date);
	if (isResult(date)) return date;
	const asset = readAsset(event.pathParameters?.asset);
	if (isResult(asset)) return asset;
	const { repo, objects } = await apiContext();
	const item = await repo.getReport(date, asset);
	if (!item) return json(404, { error: "report not found" });
	const stored = item.markdownKey ? await objects.get(item.markdownKey) : null;
	const markdown = stored ? new TextDecoder().decode(stored.body) : renderReport(item.analysis);
	return json(200, markdownResponseSchema.parse({ markdown }));
}
