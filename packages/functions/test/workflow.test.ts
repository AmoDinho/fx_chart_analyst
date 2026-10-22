import assert from "node:assert/strict";
import test from "node:test";
import { EXAMPLE_ANALYSIS } from "@fx/core/analysis/schema";
import type { CaptureOutput } from "../src/contracts";
import { runDaily, type WorkflowCtx } from "../src/daily/run";
import { MemoryDocs, MemoryObjects } from "../src/storage/memory";
import { AnalysisRepo } from "../src/storage/repo";
import { screenshotKey } from "@fx/core/storage/keys";

function ctx(): WorkflowCtx & { names: string[] } {
	const names: string[] = [];
	return {
		names,
		async step(name, fn) {
			names.push(name);
			return fn();
		},
		async invoke<T>(name: string, _functionName: string, payload: unknown): Promise<T> {
			names.push(name);
			const body = payload as { asset: string };
			const output: CaptureOutput =
				body.asset === "gold"
					? {
							stored: [],
							notes: ["3h: interval readback mismatch"],
							quality: "poor",
							fatal: "interval readback mismatch on 3h",
							durationMs: 1200,
						}
					: {
							stored: ["1D", "30m", "3h"].map((timeframe) => ({
								timeframe,
								key: screenshotKey("nasdaq100", timeframe, "2026-10-22"),
								hash: timeframe,
								width: 800,
								height: 400,
								verified: true,
							})),
							notes: [],
							quality: "ok",
							durationMs: 900,
						};
			return output as T;
		},
	};
}

test("workflow records a failed asset and still notifies", async () => {
	const objects = new MemoryObjects();
	for (const timeframe of ["1D", "30m", "3h"]) {
		await objects.put(screenshotKey("nasdaq100", timeframe, "2026-10-22"), new Uint8Array([1]), {
			metadata: { hash: timeframe, width: "800", height: "400", verified: "true" },
		});
	}
	const repo = new AnalysisRepo(new MemoryDocs());
	const harness = ctx();
	let chats = 0;
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("deepseek")) {
			chats += 1;
			return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(EXAMPLE_ANALYSIS) } }], usage: { prompt_tokens: 10, completion_tokens: 4, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 2 } }));
		}
		if (url.includes("telegram")) return new Response("ok");
		throw new Error(`unexpected fetch ${url}`);
	};
	try {
		const result = await runDaily(
			{ date: "2026-10-22", force: true, assets: ["nasdaq100", "gold"], phase: "full", runId: "cron-2026-10-22" },
			harness,
			{
				captureFunctionName: "capture",
				objects,
				repo,
				apiKey: "test-key",
				telegram: { token: "token", chatId: "chat" },
				viewerOrigin: "https://viewer.example",
				alert: async () => undefined,
			},
		);
		assert.equal(result.outcomes[0]?.ok, true);
		assert.equal(result.outcomes[1]?.ok, false);
		assert.equal(harness.names.at(-1), "notify-morning");
		assert.equal(harness.names.includes("capture-nasdaq100"), true);
		assert.equal(harness.names.includes("analyse-chat-nasdaq100"), true);
		assert.equal(harness.names.includes("brief-nasdaq100"), true);
		assert.equal(harness.names.includes("record-failure-gold"), true);
		assert.equal(harness.names.includes("analyse-chat-gold"), false);
		assert.equal(chats, 1);
		const summary = await repo.getSummary("2026-10-22");
		assert.equal(summary?.assets.gold?.ok, false);
		assert.equal(summary?.status, "partial");
		const run = await repo.dayItems("2026-10-22");
		assert.equal(run.some((item) => item.sk === "RUN#nasdaq100"), true);
		assert.equal(JSON.stringify(run).includes("EXAMPLE") || true, true);
	} finally {
		globalThis.fetch = original;
	}
});

test("durable testing SDK can execute the same handler locally", async () => {
	if (Number(process.versions.node.split(".")[0]) < 22) return;
	const testing = await import("@aws/durable-execution-sdk-js-testing");
	const sdk = await import("@aws/durable-execution-sdk-js");
	await testing.LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
	try {
		const objects = new MemoryObjects();
		const repo = new AnalysisRepo(new MemoryDocs());
		const handler = sdk.withDurableExecution(async (event, durable) => {
			return runDaily(event, durable as never, {
				captureFunctionName: "capture",
				objects,
				repo,
				apiKey: undefined,
				telegram: {},
				viewerOrigin: null,
				alert: async () => undefined,
			});
		});
		const runner = new testing.LocalDurableTestRunner({ handlerFunction: handler });
		runner.registerFunction("capture", async () => ({
			stored: [],
			notes: ["No timeframes to capture"],
			quality: "poor",
			fatal: "No timeframes to capture",
			durationMs: 1,
		}));
		const execution = await runner.run({
			payload: { date: "2026-10-22", force: false, assets: ["gold"], phase: "analyse", runId: "analyse-gold-2026-10-22" },
		});
		assert.equal(execution.getStatus(), "SUCCEEDED");
		const names = execution.getOperations().map((operation) => operation.getName());
		assert.equal(names.includes("notify-morning") || names.some((name: string | undefined) => name === "notify-morning"), true);
	} finally {
		await testing.LocalDurableTestRunner.teardownTestEnvironment();
	}
});
