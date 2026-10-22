export function screenshotKey(asset: string, timeframe: string, date: string): string {
	return `${asset}/${timeframe}/${date}.png`;
}

export function latestKey(asset: string, timeframe: string): string {
	return `${asset}/${timeframe}/latest.png`;
}

export function reportJsonKey(asset: string, date: string): string {
	return `reports/${asset}/${date}.json`;
}

export function reportMdKey(asset: string, date: string): string {
	return `reports/${asset}/${date}.md`;
}

export function briefKey(asset: string, date: string): string {
	return `briefs/${asset}/${date}.html`;
}

export function completionDraftKey(asset: string, date: string): string {
	return `drafts/${asset}/${date}/completion.json`;
}

export function tempScreenshotKey(id: string): string {
	return `tmp/screenshots/${id}.png`;
}
