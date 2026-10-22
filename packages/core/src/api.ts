import { z } from "zod";
import { chartAnalysisSchema } from "./analysis/schema";

export const ASSETS = ["nasdaq100", "gold"] as const;
export const assetSchema = z.enum(ASSETS);

export const directionSchema = z.enum(["long", "short", "stand_aside"]);
export const gradeSchema = z.enum(["A+", "B", "NO TRADE"]);
export const confidenceSchema = z.enum(["low", "medium", "high"]);
export const dayStatusSchema = z.enum(["ok", "partial", "failed", "running"]);

export const assetDaySchema = z.object({
	ok: z.boolean(),
	direction: directionSchema.optional(),
	grade: gradeSchema.optional(),
	confidence: confidenceSchema.optional(),
	captureQuality: z.enum(["ok", "poor"]).optional(),
	checklist: z
		.object({
			pass: z.number(),
			fail: z.number(),
			notVisible: z.number(),
		})
		.optional(),
	error: z.string().optional(),
});

export const daySummarySchema = z.object({
	date: z.string(),
	status: dayStatusSchema,
	executionName: z.string(),
	assets: z.object({
		nasdaq100: assetDaySchema.optional(),
		gold: assetDaySchema.optional(),
	}),
});

export const daysResponseSchema = z.object({
	days: z.array(daySummarySchema),
	nextCursor: z.string().nullable(),
});

export const chartLinkSchema = z.object({
	timeframe: z.string(),
	url: z.string(),
	width: z.number(),
	height: z.number(),
});

export const reportResponseSchema = z.object({
	analysis: chartAnalysisSchema,
	charts: z.array(chartLinkSchema),
	briefUrl: z.string().optional(),
	markdown: z.string().optional(),
});

export const dayDetailSchema = z.object({
	summary: daySummarySchema,
	reports: z.object({
		nasdaq100: reportResponseSchema.nullable(),
		gold: reportResponseSchema.nullable(),
	}),
	failures: z.array(
		z.object({
			asset: assetSchema,
			error: z.string(),
			step: z.string().optional(),
		}),
	),
});

export const historyRowSchema = z.object({
	date: z.string(),
	ok: z.boolean(),
	direction: directionSchema.optional(),
	grade: gradeSchema.optional(),
	captureQuality: z.enum(["ok", "poor"]).optional(),
	checklist: z
		.array(
			z.object({
				item: z.string(),
				result: z.enum(["PASS", "FAIL", "NOT VISIBLE"]),
			}),
		)
		.optional(),
	error: z.string().optional(),
});

export const historyResponseSchema = z.object({
	asset: assetSchema,
	from: z.string(),
	to: z.string(),
	rows: z.array(historyRowSchema),
});

export const runStepSchema = z.object({
	name: z.string(),
	durationMs: z.number(),
	outcome: z.enum(["ok", "retried", "failed"]),
	note: z.string().optional(),
});

export const runLogSchema = z.object({
	asset: assetSchema,
	ok: z.boolean(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	durationMs: z.number().nullable(),
	promptTokens: z.number().nullable(),
	completionTokens: z.number().nullable(),
	cachedTokens: z.number().nullable(),
	uncachedTokens: z.number().nullable(),
	finishReason: z.string().nullable(),
	errors: z.array(z.string()),
	steps: z.array(runStepSchema),
	framesVerified: z.string().nullable(),
});

export const runsResponseSchema = z.object({
	date: z.string(),
	executionName: z.string().nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	runs: z.array(runLogSchema),
});

export const adminRunBodySchema = z.object({
	date: z.string().optional(),
	asset: assetSchema.optional(),
	force: z.boolean().optional(),
});

export const adminStartResponseSchema = z.object({
	executionName: z.string(),
	created: z.boolean(),
});

export const screenshotBodySchema = z.object({
	asset: assetSchema,
	timeframe: z.string(),
});

export const screenshotStartSchema = z.object({
	id: z.string(),
});

export const screenshotReadySchema = z.object({
	id: z.string(),
	ready: z.boolean(),
	url: z.string().optional(),
});

export const executionSchema = z.object({
	name: z.string(),
	status: z.string(),
	startedAt: z.string().nullable(),
	endedAt: z.string().nullable(),
	durationMs: z.number().nullable(),
});

export const statusResponseSchema = z.object({
	executions: z.array(executionSchema),
});

export const markdownResponseSchema = z.object({
	markdown: z.string(),
});

export const publicConfigSchema = z.object({
	apiUrl: z.string(),
	userPoolId: z.string(),
	userPoolClientId: z.string(),
	region: z.string(),
});

export type DaySummary = z.infer<typeof daySummarySchema>;
export type DaysResponse = z.infer<typeof daysResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type DayDetail = z.infer<typeof dayDetailSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type RunsResponse = z.infer<typeof runsResponseSchema>;
export type AssetDay = z.infer<typeof assetDaySchema>;
export type RunLog = z.infer<typeof runLogSchema>;
export type MarkdownResponse = z.infer<typeof markdownResponseSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
