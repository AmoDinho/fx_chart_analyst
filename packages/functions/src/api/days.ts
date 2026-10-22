import { daysResponseSchema, type DaySummary } from "@fx/core/api";
import type { HttpEvent } from "../http";
import { badCursor, json, limitOf } from "../http";
import { apiContext } from "./context";

export async function handler(event: HttpEvent) {
	try {
		const { repo } = await apiContext();
		const limit = limitOf(event.queryStringParameters?.limit);
		const page = await repo.listDays(limit, event.queryStringParameters?.cursor);
		const body = daysResponseSchema.parse({
			days: page.items.map(toSummary),
			nextCursor: page.cursor,
		});
		return json(200, body);
	} catch (error) {
		const cursor = badCursor(error);
		if (cursor) return cursor;
		throw error;
	}
}

function toSummary(item: {
	date: string;
	status: DaySummary["status"];
	executionName: string;
	assets?: DaySummary["assets"];
}): DaySummary {
	return {
		date: item.date,
		status: item.status,
		executionName: item.executionName,
		assets: item.assets ?? {},
	};
}
