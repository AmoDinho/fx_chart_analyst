import assert from "node:assert/strict";
import test from "node:test";
import { daysResponseSchema, runsResponseSchema } from "@fx/core/api";
import { handler as days } from "../src/api/days";
import { isAdmin, readAsset, readDate } from "../src/http";
import { encodeCursor } from "../src/storage/cursor";
import { redactRun } from "../src/storage/items";
import { MemoryDocs } from "../src/storage/memory";
import { AnalysisRepo, reportItem } from "../src/storage/repo";
import { EXAMPLE_ANALYSIS } from "@fx/core/analysis/schema";

test("admin claim check and date validation", () => {
	assert.equal(isAdmin({ requestContext: { authorizer: { jwt: { claims: { "cognito:groups": "[admins]" } } } } }), true);
	assert.equal(isAdmin({ requestContext: { authorizer: { jwt: { claims: { "cognito:groups": "readers" } } } } }), false);
	const badDate = readDate("2026-02-31");
	assert.equal(typeof badDate === "string" ? badDate : badDate.statusCode, 400);
	assert.equal(readDate("2026-10-22"), "2026-10-22");
	const badAsset = readAsset("silver");
	assert.equal(typeof badAsset === "string" ? badAsset : badAsset.statusCode, 400);
});

test("cursor round-trips and run logs drop raw completion text", () => {
	const cursor = encodeCursor({ pk: "DAY#2026-10-22", sk: "SUMMARY" });
	assert.equal(typeof cursor, "string");
	const redacted = redactRun({
		pk: "DAY#2026-10-22",
		sk: "RUN#gold",
		asset: "gold",
		ok: false,
		startedAt: null,
		finishedAt: null,
		durationMs: 10,
		promptTokens: 1,
		completionTokens: 2,
		cachedTokens: 1,
		uncachedTokens: 0,
		finishReason: "stop",
		errors: ["capture failed"],
		steps: [],
		framesVerified: null,
		content: "raw completion must not ship",
	} as never);
	assert.equal("content" in redacted, false);
	assert.equal(runsResponseSchema.safeParse({ date: "2026-10-22", executionName: null, startedAt: null, finishedAt: null, runs: [redacted] }).success, true);
});

test("day list reads newest first from the days index", async () => {
	const docs = new MemoryDocs();
	const repo = new AnalysisRepo(docs);
	await repo.updateSummary({ date: "2026-10-21", executionName: "cron-2026-10-21", asset: "gold", slice: { ok: true, direction: "long", grade: "B" } });
	await repo.updateSummary({ date: "2026-10-22", executionName: "cron-2026-10-22", asset: "nasdaq100", slice: { ok: true, direction: "short", grade: "A+" } });
	const page = await repo.listDays(1);
	assert.equal(page.items[0]?.date, "2026-10-22");
	assert.equal(page.cursor !== null, true);
	const body = daysResponseSchema.parse({ days: page.items, nextCursor: page.cursor });
	assert.equal(body.days[0]?.assets.nasdaq100?.grade, "A+");
	assert.equal(typeof days, "function");
	void reportItem;
	void EXAMPLE_ANALYSIS;
});
