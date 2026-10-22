import { TIMEFRAME_LABELS, isTimeframe } from "./config";

export type CapturedFrame = {
	timeframe: string;
	label: string;
	key: string | null;
	hash: string | null;
	width: number | null;
	height: number | null;
	intervalVerified: boolean;
	stored: boolean;
	note: string | null;
};

export type CaptureStepResult = {
	asset: string;
	date: string;
	requestedTimeframes: string[];
	actualTimeframes: string[];
	frames: CapturedFrame[];
	notes: string[];
	skipped: boolean;
	captureQuality: "ok" | "poor";
};

export type CaptureRequest = {
	asset: string;
	date: string;
	timeframes: string[];
	force: boolean;
	store: boolean;
	priorHashes?: string[];
};

export function mergeCaptureResults(
	asset: string,
	date: string,
	requested: string[],
	parts: CaptureStepResult[],
): CaptureStepResult {
	const frames = parts.flatMap((part) => part.frames);
	const notes = parts.flatMap((part) => part.notes);
	const actual = frames.filter((frame) => frame.stored).map((frame) => frame.timeframe);
	const verified = frames.filter((frame) => frame.stored).every((frame) => frame.intervalVerified);
	return {
		asset,
		date,
		requestedTimeframes: requested,
		actualTimeframes: actual,
		frames,
		notes,
		skipped: parts.length > 0 && parts.every((part) => part.skipped),
		captureQuality: actual.length === requested.length && verified ? "ok" : "poor",
	};
}

export function missedCapture(asset: string, date: string, timeframe: string, message: string): CaptureStepResult {
	const label = isTimeframe(timeframe) ? TIMEFRAME_LABELS[timeframe] : timeframe;
	return {
		asset,
		date,
		requestedTimeframes: [timeframe],
		actualTimeframes: [],
		frames: [
			{
				timeframe,
				label,
				key: null,
				hash: null,
				width: null,
				height: null,
				intervalVerified: false,
				stored: false,
				note: message,
			},
		],
		notes: [`${timeframe}: ${message}`],
		skipped: false,
		captureQuality: "poor",
	};
}

export function shouldRetryCapture(result: CaptureStepResult): boolean {
	if (result.skipped || result.actualTimeframes.length > 0) return false;
	return !result.notes.some((note) => note.includes("duplicate"));
}

export function isFatalCaptureMessage(message: string): boolean {
	return (
		message.includes("Daily time limit exceeded") ||
		message.includes("CHARTS_CACHE") ||
		message.startsWith("Invalid asset") ||
		message.includes("No timeframes to capture")
	);
}
