import { runsResponseSchema } from "@fx/core/api";
import type { HttpEvent } from "../http";
import { isResult, json, readDate } from "../http";
import { redactRun, type RunItem, type SummaryItem } from "../storage/items";
import { apiContext } from "./context";

export async function handler(event: HttpEvent) {
	const date = readDate(event.pathParameters?.date);
	if (isResult(date)) return date;
	const { repo } = await apiContext();
	const items = await repo.dayItems(date);
	const summary = items.find((item) => item.sk === "SUMMARY") as SummaryItem | undefined;
	const runs = items
		.filter((item) => String(item.sk).startsWith("RUN#"))
		.map((item) => redactRun(stripRaw(item as RunItem)));
	if (!summary && runs.length === 0) return json(404, { error: "runs not found" });
	return json(
		200,
		runsResponseSchema.parse({
			date,
			executionName: summary?.executionName ?? null,
			startedAt: runs.find((run) => run.startedAt)?.startedAt ?? null,
			finishedAt: runs.map((run) => run.finishedAt).find(Boolean) ?? null,
			runs,
		}),
	);
}

function stripRaw(item: RunItem): RunItem {
	const copy = { ...item };
	delete (copy as { content?: unknown }).content;
	delete (copy as { completion?: unknown }).completion;
	return copy;
}
