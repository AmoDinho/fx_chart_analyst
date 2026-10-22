import type { ChartAnalysis } from "./analysis/schema";
import { extractRange, formatPrice } from "./report/range";

export type MorningAsset = {
	asset: string;
	ok: boolean;
	error: string | null;
};

const ALARM_NAMES: Record<string, string> = {
	gold: "GOLD",
	nasdaq100: "NASDAQ",
};

export function morningHeading(date: string): string {
	const when = new Date(`${date}T07:00:00.000Z`);
	const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Johannesburg" }).format(when);
	const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "Africa/Johannesburg" }).format(when);
	const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Africa/Johannesburg" }).format(when);
	return `${weekday} ${day} ${month} · 09:00 SAST`;
}

export function morningDigest(input: {
	date: string;
	outcomes: MorningAsset[];
	analyses: Record<string, ChartAnalysis | null>;
	origin: string | null;
}): string {
	const blocks = input.outcomes.map((outcome) => assetBlock(outcome, input.analyses[outcome.asset] ?? null, input));
	const text = [morningHeading(input.date), "", ...blocks].join("\n\n");
	return text.length <= 3900 ? text : `${text.slice(0, 3890).trimEnd()}…`;
}

export async function sendTelegram(
	secrets: { token?: string; chatId?: string },
	text: string,
): Promise<{ sent: boolean }> {
	const token = secrets.token;
	const chat = secrets.chatId;
	if (!token || !chat) {
		console.log(JSON.stringify({ event: "telegram.skipped", reason: "missing secrets" }));
		return { sent: false };
	}
	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`telegram ${response.status}: ${body.replaceAll(token, "[redacted]").slice(0, 300)}`);
	}
	return { sent: true };
}

function assetBlock(
	outcome: MorningAsset,
	analysis: ChartAnalysis | null,
	input: { date: string; origin: string | null },
): string {
	const name = ALARM_NAMES[outcome.asset] ?? outcome.asset.toUpperCase();
	if (!outcome.ok || !analysis) {
		return [`${name} · no brief`, clip(outcome.error ?? "analysis failed", 220)].join("\n");
	}
	const range = extractRange(analysis);
	const counts = countChecks(analysis);
	const lines = [
		`${name} · ${alarmVerdict(analysis.verdict.direction)} · ${analysis.verdict.grade}`,
		biasLine(analysis),
		range
			? `Close ${formatPrice(range.close)} · range ~${formatPrice(range.low)}–${formatPrice(range.high)} · eq ~${formatPrice(range.equilibrium)} · ${range.side}`
			: null,
		`Checklist: ${counts.pass} pass, ${counts.fail} fail, ${counts.miss} not visible`,
		clip(analysis.verdict.reason, 240),
		reportUrl(outcome.asset, input),
	];
	return lines.filter(Boolean).join("\n");
}

function reportUrl(asset: string, input: { date: string; origin: string | null }): string {
	const path = `/r/${asset}/${input.date}`;
	if (!input.origin) return `Report: ${path}`;
	return `${input.origin.replace(/\/$/, "")}${path}`;
}

function biasLine(analysis: ChartAnalysis): string {
	const direction = analysis.bias.direction;
	const head = `${direction.charAt(0).toUpperCase()}${direction.slice(1)} daily`;
	const agreement = analysis.bias.timeframe_agreement?.replace(/^conflict:\s*/i, "conflict with ").trim();
	if (!agreement) return `${head}.`;
	const line = `${head}, ${agreement}.`;
	return line.length <= 180 ? line : `${line.slice(0, 177).trimEnd()}…`;
}

function alarmVerdict(direction: ChartAnalysis["verdict"]["direction"]): string {
	if (direction === "stand_aside") return "STAND ASIDE";
	if (direction === "long") return "LONG";
	return "SHORT";
}

function countChecks(analysis: ChartAnalysis): { pass: number; fail: number; miss: number } {
	const counts = { pass: 0, fail: 0, miss: 0 };
	for (const item of analysis.verdict.checklist) {
		if (item.result === "PASS") counts.pass += 1;
		else if (item.result === "FAIL") counts.fail += 1;
		else counts.miss += 1;
	}
	return counts;
}

function clip(value: string | null, max: number): string | null {
	if (!value) return null;
	const flat = value.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const cut = flat.slice(0, max);
	const stop = cut.lastIndexOf(". ");
	return (stop > 80 ? cut.slice(0, stop + 1) : cut).trim();
}
