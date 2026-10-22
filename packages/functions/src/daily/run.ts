import { completeChat } from "@fx/core/analysis/client";
import { isUnusableCompletion, parseAnalysis } from "@fx/core/analysis/parse";
import { buildRunContext, buildUserContent } from "@fx/core/analysis/request";
import type { ChartAnalysis } from "@fx/core/analysis/schema";
import { correctionText, stampAnalysis } from "@fx/core/analysis/stamp";
import { DAILY_TIMEFRAMES, TIMEFRAME_LABELS, isAsset, isTimeframe, type Asset } from "@fx/core/capture/config";
import { morningDigest, sendTelegram, type MorningAsset } from "@fx/core/notify";
import { renderBrief } from "@fx/core/report/brief";
import { renderReport } from "@fx/core/report/render";
import { briefKey, completionDraftKey, reportJsonKey, reportMdKey, screenshotKey } from "@fx/core/storage/keys";
import { normalizeParams, type DailyParams } from "@fx/core/workflow-params";
import type { AlertPayload, CaptureOutput, DraftRecord, StoredFrame } from "../contracts";
import { log } from "../log";
import { NonRetryableError, chatRetry, exponentialRetry, noRetry, type RetryDecision } from "../retry";
import { assetSliceFromAnalysis, type RunStepRecord } from "../storage/items";
import { failItem, reportItem, type AnalysisRepo } from "../storage/repo";
import type { ObjectStore } from "../storage/types";

export type DailyDeps = {
	captureFunctionName: string;
	objects: ObjectStore;
	repo: AnalysisRepo;
	apiKey: string | undefined;
	telegram: { token?: string; chatId?: string };
	viewerOrigin: string | null;
	alert: (message: AlertPayload) => Promise<void>;
	now?: () => string;
};

export type WorkflowCtx = {
	step<T>(name: string, fn: () => Promise<T>, opts?: { retryStrategy?: (error: unknown, attempt: number) => RetryDecision }): Promise<T>;
	invoke<T>(
		name: string,
		functionName: string,
		payload: unknown,
		opts?: { retryStrategy?: (error: unknown, attempt: number) => RetryDecision },
	): Promise<T>;
};

type Timed<T> = { value: T; durationMs: number; note?: string; outcome: "ok" | "retried" };

export async function runDaily(event: unknown, ctx: WorkflowCtx, deps: DailyDeps) {
	const params = normalizeParams(event);
	const now = deps.now ?? (() => new Date().toISOString());
	await ctx.step(
		"open-day",
		() => deps.repo.updateSummary({ date: params.date, executionName: params.runId, running: true }),
		{ retryStrategy: exponentialRetry(1, 10) },
	);

	const outcomes: MorningAsset[] = [];
	for (const asset of params.assets) {
		if (!isAsset(asset)) continue;
		try {
			outcomes.push(await analyseAsset(ctx, deps, params, asset, now));
		} catch (error) {
			const message = error instanceof Error ? error.message : "analysis failed";
			log({ event: "asset.failed", runId: params.runId, asset, step: "asset", error: message });
			await ctx.step(`record-failure-${asset}`, async () => {
				await deps.repo.putFail(failItem(params.date, asset, message));
				await deps.repo.updateSummary({
					date: params.date,
					executionName: params.runId,
					asset,
					slice: { ok: false, error: message },
				});
				await deps.alert({ kind: "failure", asset, date: params.date, message, runId: params.runId });
				return { recorded: true };
			});
			outcomes.push({ asset, ok: false, error: message });
		}
	}

	await ctx.step(
		"notify-morning",
		async () => {
			const analyses = await loadAnalyses(deps, params);
			const text = morningDigest({
				date: params.date,
				outcomes,
				analyses,
				origin: deps.viewerOrigin,
			});
			const sent = await sendTelegram(deps.telegram, text);
			await deps.repo.finishDay(params.date, params.runId);
			log({ event: "notify.morning", runId: params.runId, asset: "both", step: "notify-morning", sent: sent.sent });
			return { sent: sent.sent };
		},
		{ retryStrategy: exponentialRetry(2, 20) },
	);

	return { date: params.date, runId: params.runId, outcomes };
}

async function analyseAsset(
	ctx: WorkflowCtx,
	deps: DailyDeps,
	params: DailyParams,
	asset: Asset,
	now: () => string,
): Promise<MorningAsset> {
	const steps: RunStepRecord[] = [];
	let capture: CaptureOutput | null = null;
	if (params.phase === "full") {
		const started = Date.now();
		capture = await ctx.invoke<CaptureOutput>(
			`capture-${asset}`,
			deps.captureFunctionName,
			{
				asset,
				date: params.date,
				timeframes: DAILY_TIMEFRAMES,
				force: params.force,
				store: true,
			},
			{ retryStrategy: exponentialRetry(2, 20) },
		);
		steps.push({
			name: `capture-${asset}`,
			durationMs: capture.durationMs || Date.now() - started,
			outcome: "ok",
			note: capture.notes.at(-1),
		});
		if (capture.fatal) throw new NonRetryableError(capture.fatal);
	}

	const prepare = await timed(ctx, `analyse-prepare-${asset}`, async () => {
		if (!params.force) {
			const existing = await deps.repo.getReport(params.date, asset);
			if (existing) return { skip: true as const, frames: existing.charts, notes: [] as string[], hintPoor: false };
		}
		const frames = capture ? capture.stored : await loadStoredFrames(deps, asset, params.date);
		if (frames.length === 0) throw new NonRetryableError(`no stored frames for ${asset}`);
		const hintPoor = capture?.quality === "poor" || frames.length < DAILY_TIMEFRAMES.length || frames.some((frame) => !frame.verified);
		return { skip: false as const, frames, notes: capture?.notes ?? [], hintPoor };
	}, exponentialRetry(1, 10), steps);

	if (prepare.skip) {
		await writeRun(deps, params, asset, steps, { ok: true });
		return { asset, ok: true, error: null };
	}

	let chat = await timed(
		ctx,
		`analyse-chat-${asset}`,
		() => draftCompletion(deps, params, asset, prepare.frames, prepare.notes),
		chatRetry,
		steps,
	);
	if (chat.unusable) {
		const retried = await timed(
			ctx,
			`analyse-chat-retry-${asset}`,
			() => draftCompletion(deps, params, asset, prepare.frames, prepare.notes),
			() => noRetry(),
			steps,
		);
		steps[steps.length - 2] = { ...steps[steps.length - 2]!, outcome: "retried", note: "1 retry on empty or length" };
		chat = retried;
	}

	let parsed: { finishReason: string | null; usage: DraftRecord["usage"] };
	try {
		parsed = await timed(
			ctx,
			`analyse-parse-${asset}`,
			() => parseAndStore(deps, params, asset, chat.key, prepare, now),
			exponentialRetry(1, 10),
			steps,
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : "invalid json";
		const corrected = await timed(
			ctx,
			`analyse-chat-correct-${asset}`,
			() => draftCompletion(deps, params, asset, prepare.frames, prepare.notes, correctionText(detail)),
			() => noRetry(),
			steps,
		);
		parsed = await timed(
			ctx,
			`analyse-parse-retry-${asset}`,
			() => parseAndStore(deps, params, asset, corrected.key, prepare, now),
			() => noRetry(),
			steps,
		);
	}

	await timed(
		ctx,
		`brief-${asset}`,
		async () => {
			const report = await deps.repo.getReport(params.date, asset);
			if (!report) throw new Error("report missing before brief");
			const html = renderBrief(report.analysis, "");
			await deps.objects.put(briefKey(asset, params.date), html, { contentType: "text/html" });
			await writeRun(deps, params, asset, steps, {
				ok: true,
				finishReason: parsed.finishReason,
				usage: parsed.usage,
				framesVerified: `${prepare.frames.filter((frame) => frame.verified).length}/${DAILY_TIMEFRAMES.length}`,
			});
			return { key: briefKey(asset, params.date) };
		},
		exponentialRetry(1, 10),
		steps,
	);

	return { asset, ok: true, error: null };
}

async function draftCompletion(
	deps: DailyDeps,
	params: DailyParams,
	asset: Asset,
	frames: Array<{ timeframe: string; key: string }>,
	notes: string[],
	extra?: string,
): Promise<{ key: string; unusable: boolean; finishReason: string | null; usage: DraftRecord["usage"] }> {
	const images = [];
	for (const frame of frames) {
		const object = await deps.objects.get(frame.key);
		if (!object) continue;
		images.push({
			label: isTimeframe(frame.timeframe) ? TIMEFRAME_LABELS[frame.timeframe] : frame.timeframe,
			base64: Buffer.from(object.body).toString("base64"),
		});
	}
	if (images.length === 0) throw new NonRetryableError(`no images for ${asset}`);
	const context = [buildRunContext({
		asset,
		date: params.date,
		requested: [...DAILY_TIMEFRAMES],
		actual: frames.map((frame) => frame.timeframe),
		notes,
	}), extra]
		.filter(Boolean)
		.join("\n\n");
	const completion = await completeChat({ apiKey: deps.apiKey }, buildUserContent(images, context));
	const key = completionDraftKey(asset, params.date);
	const draft: DraftRecord = {
		content: completion.content,
		finishReason: completion.finishReason,
		usage: {
			prompt_tokens: completion.usage.prompt_tokens,
			completion_tokens: completion.usage.completion_tokens,
			prompt_cache_hit_tokens: completion.usage.prompt_cache_hit_tokens,
			prompt_cache_miss_tokens: completion.usage.prompt_cache_miss_tokens,
		},
	};
	await deps.objects.put(key, JSON.stringify(draft), { contentType: "application/json" });
	return {
		key,
		unusable: isUnusableCompletion(completion.content, completion.finishReason),
		finishReason: completion.finishReason,
		usage: draft.usage,
	};
}

async function parseAndStore(
	deps: DailyDeps,
	params: DailyParams,
	asset: Asset,
	draftKey: string,
	prepare: { frames: StoredFrame[]; notes: string[]; hintPoor: boolean },
	now: () => string,
): Promise<{ finishReason: string | null; usage: DraftRecord["usage"] }> {
	const object = await deps.objects.get(draftKey);
	if (!object) throw new SyntaxError("draft missing");
	const draft = JSON.parse(new TextDecoder().decode(object.body)) as DraftRecord;
	if (!draft.content?.trim()) throw new SyntaxError("empty completion");
	const parsed = parseAnalysis(draft.content);
	const analysis = stampAnalysis(
		parsed,
		{ asset },
		[...DAILY_TIMEFRAMES],
		prepare.frames.map((frame) => frame.timeframe),
		prepare.notes,
		prepare.hintPoor,
		now(),
	);
	const markdown = renderReport(analysis);
	await deps.objects.put(reportJsonKey(asset, params.date), JSON.stringify(analysis), { contentType: "application/json" });
	await deps.objects.put(reportMdKey(asset, params.date), markdown, { contentType: "text/markdown; charset=utf-8" });
	await deps.repo.putReport(
		reportItem({
			date: params.date,
			asset,
			analysis,
			charts: prepare.frames.map((frame) => ({
				timeframe: frame.timeframe,
				key: frame.key,
				width: frame.width,
				height: frame.height,
			})),
			markdownKey: reportMdKey(asset, params.date),
			briefKey: briefKey(asset, params.date),
		}),
	);
	await deps.repo.updateSummary({
		date: params.date,
		executionName: params.runId,
		asset,
		slice: assetSliceFromAnalysis(analysis),
	});
	await deps.objects.delete(draftKey);
	await maybeAlert(deps, params, asset, analysis);
	return { finishReason: draft.finishReason, usage: draft.usage };
}

async function maybeAlert(deps: DailyDeps, params: DailyParams, asset: Asset, analysis: ChartAnalysis): Promise<void> {
	try {
		if (analysis.capture.capture_quality === "poor") {
			await deps.alert({
				kind: "poor-capture",
				asset,
				date: params.date,
				runId: params.runId,
				message: analysis.capture.notes ?? "capture quality poor",
			});
		} else if (analysis.method_citations.length === 0) {
			await deps.alert({
				kind: "grounding",
				asset,
				date: params.date,
				runId: params.runId,
				message: "method_citations is empty",
			});
		}
	} catch (error) {
		log({
			event: "alert.failed",
			runId: params.runId,
			asset,
			step: "analyse-parse",
			error: error instanceof Error ? error.message : "alert failed",
		});
	}
}

async function loadStoredFrames(deps: DailyDeps, asset: Asset, date: string): Promise<StoredFrame[]> {
	const frames: StoredFrame[] = [];
	for (const timeframe of DAILY_TIMEFRAMES) {
		const key = screenshotKey(asset, timeframe, date);
		const head = await deps.objects.head(key);
		if (!head?.metadata.hash) continue;
		frames.push({
			timeframe,
			key,
			hash: head.metadata.hash,
			width: Number(head.metadata.width) || 0,
			height: Number(head.metadata.height) || 0,
			verified: head.metadata.verified === "true",
		});
	}
	return frames;
}

async function loadAnalyses(deps: DailyDeps, params: DailyParams): Promise<Record<string, ChartAnalysis | null>> {
	const analyses: Record<string, ChartAnalysis | null> = {};
	for (const asset of params.assets) {
		if (!isAsset(asset)) continue;
		analyses[asset] = (await deps.repo.getReport(params.date, asset))?.analysis ?? null;
	}
	return analyses;
}

async function writeRun(
	deps: DailyDeps,
	params: DailyParams,
	asset: Asset,
	steps: RunStepRecord[],
	extra: {
		ok: boolean;
		finishReason?: string | null;
		usage?: DraftRecord["usage"];
		framesVerified?: string | null;
		error?: string;
	},
): Promise<void> {
	const duration = steps.reduce((sum, step) => sum + step.durationMs, 0);
	await deps.repo.putRun({
		pk: `DAY#${params.date}`,
		sk: `RUN#${asset}`,
		asset,
		ok: extra.ok,
		startedAt: null,
		finishedAt: new Date().toISOString(),
		durationMs: duration,
		promptTokens: extra.usage?.prompt_tokens ?? null,
		completionTokens: extra.usage?.completion_tokens ?? null,
		cachedTokens: extra.usage?.prompt_cache_hit_tokens ?? null,
		uncachedTokens: extra.usage?.prompt_cache_miss_tokens ?? null,
		finishReason: extra.finishReason ?? null,
		errors: extra.error ? [extra.error] : [],
		steps,
		framesVerified: extra.framesVerified ?? null,
	});
}

async function timed<T>(
	ctx: WorkflowCtx,
	name: string,
	fn: () => Promise<T>,
	retryStrategy: (error: unknown, attempt: number) => RetryDecision,
	steps: RunStepRecord[],
): Promise<T> {
	const result = await ctx.step<Timed<T>>(
		name,
		async () => {
			const started = Date.now();
			const value = await fn();
			return { value, durationMs: Date.now() - started, outcome: "ok" };
		},
		{ retryStrategy },
	);
	steps.push({ name, durationMs: result.durationMs, outcome: result.outcome, note: result.note });
	return result.value;
}
