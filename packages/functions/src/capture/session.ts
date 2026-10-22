import {
	ASSET_URLS,
	DAILY_TIMEFRAMES,
	TIMEFRAME_FALLBACK,
	TIMEFRAME_LABELS,
	isAsset,
	isTimeframe,
	type Timeframe,
} from "@fx/core/capture/config";
import { intervalLabelMatches, isDuplicateHash, sha256Hex } from "@fx/core/capture/verify";
import { clipBox, isChartBoxVisible, pngSize, type Box } from "@fx/core/capture/visibility";
import { latestKey, screenshotKey, tempScreenshotKey } from "@fx/core/storage/keys";
import type { CaptureInput, CaptureOutput, StoredFrame } from "../contracts";
import type { ObjectStore } from "../storage/types";

export type SelectResult = {
	readback: string;
	box: Box | null;
	menuLabels: string[];
};

export type PageDriver = {
	goto(url: string): Promise<void>;
	prepare(): Promise<void>;
	select(timeframe: string): Promise<SelectResult>;
	screenshot(clip: Box): Promise<Uint8Array>;
	close(): Promise<void>;
};

export async function captureAsset(
	input: CaptureInput,
	objects: ObjectStore,
	openPage: () => Promise<PageDriver>,
): Promise<CaptureOutput> {
	const started = Date.now();
	if (!isAsset(input.asset)) {
		return finish([], [`Invalid asset ${input.asset}`], `Invalid asset ${input.asset}`, started);
	}
	const requested = input.timeframes.filter((item) => item.length > 0);
	if (requested.length === 0) {
		return finish([], ["No timeframes to capture"], "No timeframes to capture", started);
	}
	const notes: string[] = [];
	const stored: StoredFrame[] = [];
	const hashes: string[] = [];
	const pending: string[] = [];

	for (const timeframe of requested) {
		if (!input.force && input.store) {
			const cached = await cachedFrame(objects, input.asset, timeframe, input.date);
			if (cached) {
				stored.push(cached);
				hashes.push(cached.hash);
				continue;
			}
		}
		pending.push(timeframe);
	}

	if (pending.length === 0) {
		return finish(stored, notes, undefined, started, requested);
	}

	const page = await openPage();
	try {
		await page.goto(ASSET_URLS[input.asset]);
		await page.prepare();
		for (const timeframe of pending) {
			const frame = await captureFrame(page, objects, input, timeframe, hashes, notes);
			if (frame) {
				stored.push(frame);
				hashes.push(frame.hash);
				continue;
			}
			const fallback = isTimeframe(timeframe) ? TIMEFRAME_FALLBACK[timeframe] : undefined;
			const alreadyStored = Boolean(fallback && stored.some((item) => item.timeframe === fallback));
			const alreadyAttempted = Boolean(fallback && pending.includes(fallback));
			if (fallback && !alreadyStored && !alreadyAttempted) {
				notes.push(`${timeframe} missed; ${fallback} was not already stored, trying fallback`);
				const recovered = await captureFrame(page, objects, input, fallback, hashes, notes);
				if (recovered) {
					stored.push(recovered);
					hashes.push(recovered.hash);
				}
			} else if (fallback && alreadyStored) {
				notes.push(`${timeframe} missed; ${fallback} already stored, no fallback`);
			}
		}
	} finally {
		await page.close();
	}
	return finish(stored, notes, undefined, started, requested);
}

async function captureFrame(
	page: PageDriver,
	objects: ObjectStore,
	input: CaptureInput,
	timeframe: string,
	hashes: string[],
	notes: string[],
): Promise<StoredFrame | null> {
	const label = isTimeframe(timeframe) ? TIMEFRAME_LABELS[timeframe] : timeframe;
	let last = "interval not selected";
	for (let attempt = 0; attempt < 2; attempt++) {
		const selected = await page.select(timeframe);
		const verified = intervalLabelMatches(selected.readback, timeframe, label);
		if (!verified) {
			last = `interval readback mismatch on ${timeframe} (got "${selected.readback || "empty"}")`;
			continue;
		}
		if (!selected.box || !isChartBoxVisible(selected.box)) {
			last = `${timeframe} chart box below 600×300`;
			continue;
		}
		const clip = clipBox(selected.box);
		const bytes = await page.screenshot(clip);
		const size = pngSize(bytes);
		if (!size || !isChartBoxVisible(size)) {
			last = `${timeframe} PNG IHDR failed visibility`;
			continue;
		}
		const hash = await sha256Hex(bytes);
		if (isDuplicateHash(hash, hashes)) {
			last = `${timeframe} duplicate hash`;
			continue;
		}
		const key = input.store ? screenshotKey(input.asset, timeframe, input.date) : tempScreenshotKey(input.id ?? `${input.asset}-${timeframe}`);
		const metadata = {
			hash,
			width: String(size.width),
			height: String(size.height),
			verified: "true",
		};
		await objects.put(key, bytes, { contentType: "image/png", metadata });
		if (input.store) await objects.copy(key, latestKey(input.asset, timeframe));
		return { timeframe, key, hash, width: size.width, height: size.height, verified: true };
	}
	notes.push(`${timeframe}: ${last}`);
	return null;
}

async function cachedFrame(
	objects: ObjectStore,
	asset: string,
	timeframe: string,
	date: string,
): Promise<StoredFrame | null> {
	const key = screenshotKey(asset, timeframe, date);
	const head = await objects.head(key);
	if (!head) return null;
	const hash = head.metadata.hash;
	const width = Number(head.metadata.width);
	const height = Number(head.metadata.height);
	if (!hash || !Number.isFinite(width) || !Number.isFinite(height) || !isChartBoxVisible({ width, height })) {
		return null;
	}
	return {
		timeframe,
		key,
		hash,
		width,
		height,
		verified: head.metadata.verified === "true",
	};
}

function finish(
	stored: StoredFrame[],
	notes: string[],
	fatal: string | undefined,
	started: number,
	requested: string[] = DAILY_TIMEFRAMES,
): CaptureOutput {
	const verified = stored.length > 0 && stored.every((frame) => frame.verified);
	const complete = requested.every((timeframe) => stored.some((frame) => frame.timeframe === timeframe));
	return {
		stored,
		notes,
		quality: fatal || !complete || !verified ? "poor" : "ok",
		fatal,
		durationMs: Date.now() - started,
	};
}

export function parseCaptureInput(event: unknown): CaptureInput {
	const row = unwrap(event);
	if (!row || typeof row.asset !== "string" || typeof row.date !== "string" || !Array.isArray(row.timeframes)) {
		throw new Error("capture input invalid");
	}
	return {
		asset: row.asset,
		date: row.date,
		timeframes: row.timeframes.filter((item): item is string => typeof item === "string"),
		force: row.force === true,
		store: row.store !== false,
		id: typeof row.id === "string" ? row.id : undefined,
	};
}

function unwrap(event: unknown): Record<string, unknown> | null {
	if (!event || typeof event !== "object") return null;
	const row = event as Record<string, unknown>;
	if (typeof row.body === "string") {
		try {
			return JSON.parse(row.body) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return row;
}

export function requestedOrDaily(timeframes: string[]): Timeframe[] {
	const known = timeframes.filter(isTimeframe);
	return known.length > 0 ? known : [...DAILY_TIMEFRAMES];
}
