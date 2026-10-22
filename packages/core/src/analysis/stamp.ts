import type { CaptureStepResult } from "../capture/browser";
import { PROMPT_VERSION } from "./prompt";
import { resolveModel } from "./client";
import { SCHEMA_VERSION, type ChartAnalysis } from "./schema";

export function stampAnalysis(
	analysis: ChartAnalysis,
	input: { asset: string; model?: string },
	requested: string[],
	actual: string[],
	notes: string[],
	hintPoor: boolean,
	generatedAt = new Date().toISOString(),
): ChartAnalysis {
	const mergedNotes = [notes.join(" ").trim(), analysis.capture.notes].filter(Boolean).join(" ") || null;
	return {
		...analysis,
		schema_version: SCHEMA_VERSION,
		prompt_version: PROMPT_VERSION,
		model: resolveModel(input.model),
		generated_at_utc: generatedAt,
		asset: input.asset,
		capture: {
			...analysis.capture,
			requested_timeframes: requested,
			actual_timeframes: actual,
			capture_quality: hintPoor || analysis.capture.capture_quality === "poor" ? "poor" : "ok",
			notes: mergedNotes,
		},
	};
}

export function correctionText(detail: string): string {
	return `The previous json failed validation: ${detail}\nReturn one corrected json object. No markdown fence.`;
}

export function storedTimeframes(capture: CaptureStepResult | null, fallback: string[]): string[] {
	return (
		capture?.frames.filter((frame) => frame.stored && frame.key).map((frame) => frame.timeframe) ??
		capture?.actualTimeframes ??
		fallback
	);
}
