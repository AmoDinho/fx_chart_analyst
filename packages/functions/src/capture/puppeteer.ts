import { INTERVAL_BUTTON_TOKENS, TIMEFRAME_LABELS, isTimeframe } from "@fx/core/capture/config";
import { shouldAbortRequest } from "@fx/core/capture/requests";
import type { Box } from "@fx/core/capture/visibility";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { PageDriver, SelectResult } from "./session";

const OVERLAY_CSS = `
[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="onetrust" i],
.fc-consent-root, #sp_message_container, iframe[src*="doubleclick"],
iframe[src*="googlesyndication"], [class*="advert" i], [id*="google_ads"] {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

export async function launchPage(): Promise<PageDriver> {
	const browser = await puppeteer.launch({
		args: chromium.args,
		defaultViewport: { width: 1440, height: 900 },
		executablePath: await chromium.executablePath(),
		headless: true,
	});
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 900 });
	await page.setRequestInterception(true);
	page.on("request", (request) => {
		if (shouldAbortRequest(request.url(), request.resourceType())) void request.abort();
		else void request.continue();
	});
	return new PuppeteerPage(browser, page);
}

class PuppeteerPage implements PageDriver {
	constructor(
		private readonly browser: Browser,
		private readonly page: Page,
	) {}

	async goto(url: string): Promise<void> {
		await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
	}

	async prepare(): Promise<void> {
		await this.page.addStyleTag({ content: OVERLAY_CSS });
		await this.page.waitForNetworkIdle({ idleTime: 500, timeout: 8_000 }).catch(() => undefined);
		await sleep(3_000);
	}

	async select(timeframe: string): Promise<SelectResult> {
		const label = isTimeframe(timeframe) ? TIMEFRAME_LABELS[timeframe] : timeframe;
		const tokens = isTimeframe(timeframe) ? [...INTERVAL_BUTTON_TOKENS[timeframe]] : [timeframe];
		const selected = await this.page.evaluate(selectInterval, tokens, label);
		await sleep(1_500);
		return {
			readback: selected.readback,
			menuLabels: selected.menuLabels,
			box: selected.box,
		};
	}

	async screenshot(clip: Box): Promise<Uint8Array> {
		const bytes = await this.page.screenshot({ clip, type: "png" });
		return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	}

	async close(): Promise<void> {
		await this.browser.close();
	}
}

function selectInterval(tokens: string[], fullLabel: string): { readback: string; box: Box | null; menuLabels: string[] } {
	const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
	const wanted = new Set(tokens.map(norm));
	wanted.add(norm(fullLabel));
	const roots: ParentNode[] = [document];
	for (const frame of Array.from(document.querySelectorAll("iframe"))) {
		try {
			if (frame.contentDocument) roots.push(frame.contentDocument);
		} catch {
			/* cross-origin frame */
		}
	}
	const clickable = (root: ParentNode) =>
		Array.from(root.querySelectorAll("button, [role='button'], [role='radio'], [role='menuitem'], label, a, input"));
	const textOf = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
	const matches = (el: Element) => {
		const text = norm(textOf(el));
		if (!text || text.length > 48) return false;
		return wanted.has(text) || [...wanted].some((token) => token.length > 1 && text === token);
	};
	const radios: HTMLElement[] = [];
	const others: HTMLElement[] = [];
	for (const root of roots) {
		for (const el of clickable(root)) {
			if (!(el instanceof HTMLElement) || !matches(el)) continue;
			const role = el.getAttribute("role");
			if (role === "radio" || el.tagName === "INPUT") radios.push(el);
			else others.push(el);
		}
	}
	let target = radios[0] ?? others[0];
	if (!target) {
		const opener = roots
			.flatMap((root) => clickable(root))
			.find((el) => /interval|timeframe|resolution/i.test(`${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`));
		if (opener instanceof HTMLElement) {
			opener.click();
			const found = roots
				.flatMap((root) => clickable(root))
				.find((el): el is HTMLElement => el instanceof HTMLElement && matches(el));
			if (found) target = found;
		}
	}
	target?.click();
	const active = roots.flatMap((root) => clickable(root)).find((el) => {
		return (
			el.getAttribute("aria-pressed") === "true" ||
			el.getAttribute("aria-checked") === "true" ||
			el.getAttribute("aria-selected") === "true" ||
			String(el.className).toLowerCase().includes("active")
		);
	});
	const readback = [active ? textOf(active) : "", target ? textOf(target) : ""].filter(Boolean).join("|");
	const menuLabels = roots
		.flatMap((root) => clickable(root))
		.map(textOf)
		.filter((text) => text.length > 0 && text.length < 48);
	return { readback, box: largestChartBox(), menuLabels };
}

function largestChartBox(): Box | null {
	const nodes = Array.from(document.querySelectorAll("canvas, iframe, [class*='chart'], [id*='chart']"));
	let best: Box | null = null;
	for (const node of nodes) {
		const rect = node.getBoundingClientRect();
		if (rect.width < 200 || rect.height < 120) continue;
		if (!best || rect.width * rect.height > best.width * best.height) {
			best = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		}
	}
	return best;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
