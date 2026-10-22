import { historyResponseSchema } from "@fx/core/api";
import { isUtcDate } from "@fx/core/capture/config";
import type { HttpEvent } from "../http";
import { isResult, json, readAsset } from "../http";
import { apiContext } from "./context";

export async function handler(event: HttpEvent) {
	const asset = readAsset(event.pathParameters?.asset);
	if (isResult(asset)) return asset;
	const from = event.queryStringParameters?.from;
	const to = event.queryStringParameters?.to;
	if (!from || !to || !isUtcDate(from) || !isUtcDate(to) || from > to) return json(400, { error: "bad range" });
	const { repo } = await apiContext();
	const rows = await repo.history(asset, from, to);
	return json(
		200,
		historyResponseSchema.parse({
			asset,
			from,
			to,
			rows: rows.map((item) => {
				if (String(item.sk).startsWith("FAIL#")) {
					const fail = item as unknown as { gsi2sk?: string; date?: string; error?: string };
					return { date: fail.date ?? fail.gsi2sk ?? "", ok: false, error: fail.error };
				}
				return {
					date: item.date,
					ok: true,
					direction: item.analysis.verdict.direction,
					grade: item.analysis.verdict.grade,
					captureQuality: item.analysis.capture.capture_quality,
					checklist: item.analysis.verdict.checklist,
				};
			}),
		}),
	);
}
