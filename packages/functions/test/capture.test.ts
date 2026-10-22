import assert from "node:assert/strict";
import test from "node:test";
import { pngSize } from "@fx/core/capture/visibility";
import { screenshotKey } from "@fx/core/storage/keys";
import { captureAsset, type PageDriver } from "../src/capture/session";
import { MemoryObjects } from "../src/storage/memory";

function png(width = 800, height = 400): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
	bytes.set([0, 0, 0, 13], 8);
	bytes.set([73, 72, 68, 82], 12);
	bytes[16] = (width >> 24) & 255;
	bytes[17] = (width >> 16) & 255;
	bytes[18] = (width >> 8) & 255;
	bytes[19] = width & 255;
	bytes[20] = (height >> 24) & 255;
	bytes[21] = (height >> 16) & 255;
	bytes[22] = (height >> 8) & 255;
	bytes[23] = height & 255;
	return bytes;
}

function driver(script: Partial<PageDriver> & { selects?: string[] }): PageDriver {
	return {
		async goto() {},
		async prepare() {},
		async select(timeframe) {
			script.selects?.push(timeframe);
			return script.select ? script.select(timeframe) : { readback: timeframe, box: { x: 0, y: 0, width: 800, height: 400 }, menuLabels: [] };
		},
		async screenshot() {
			return script.screenshot ? script.screenshot({ x: 0, y: 0, width: 800, height: 400 }) : png();
		},
		async close() {},
	};
}

test("cache hit with metadata does not open the browser", async () => {
	const objects = new MemoryObjects();
	const key = screenshotKey("gold", "1D", "2026-10-22");
	await objects.put(key, png(), { metadata: { hash: "abc", width: "800", height: "400", verified: "true" } });
	let opened = false;
	const result = await captureAsset(
		{ asset: "gold", date: "2026-10-22", timeframes: ["1D"], force: false, store: true },
		objects,
		async () => {
			opened = true;
			return driver({});
		},
	);
	assert.equal(opened, false);
	assert.equal(result.quality, "ok");
	assert.equal(result.stored[0]?.hash, "abc");
	assert.equal(pngSize(png())?.width, 800);
});

test("cache hit without metadata is recaptured", async () => {
	const objects = new MemoryObjects();
	await objects.put(screenshotKey("gold", "1D", "2026-10-22"), png(), { metadata: {} });
	const selects: string[] = [];
	const result = await captureAsset(
		{ asset: "gold", date: "2026-10-22", timeframes: ["1D"], force: false, store: true },
		objects,
		async () => driver({ selects }),
	);
	assert.deepEqual(selects, ["1D"]);
	assert.equal(result.stored[0]?.verified, true);
	assert.ok(result.stored[0]?.hash);
});

test("3h miss does not fall back when 30m is already stored", async () => {
	const objects = new MemoryObjects();
	await objects.put(screenshotKey("gold", "30m", "2026-10-22"), png(), {
		metadata: { hash: "30", width: "800", height: "400", verified: "true" },
	});
	const selects: string[] = [];
	const result = await captureAsset(
		{ asset: "gold", date: "2026-10-22", timeframes: ["30m", "3h"], force: false, store: true },
		objects,
		async () =>
			driver({
				selects,
				async select(timeframe) {
					selects.push(timeframe);
					if (timeframe === "3h") return { readback: "1D", box: { x: 0, y: 0, width: 800, height: 400 }, menuLabels: [] };
					return { readback: timeframe, box: { x: 0, y: 0, width: 800, height: 400 }, menuLabels: [] };
				},
			}),
	);
	assert.equal(selects.includes("30m"), false);
	assert.equal(result.notes.some((note) => note.includes("already stored, no fallback")), true);
	assert.equal(result.quality, "poor");
});

test("invalid asset is fatal and does not open a browser", async () => {
	let opened = false;
	const result = await captureAsset(
		{ asset: "eurusd", date: "2026-10-22", timeframes: ["1D"], force: true, store: true },
		new MemoryObjects(),
		async () => {
			opened = true;
			return driver({});
		},
	);
	assert.equal(opened, false);
	assert.match(result.fatal ?? "", /Invalid asset/);
});
