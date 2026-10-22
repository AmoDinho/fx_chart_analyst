export function encodeCursor(key: Record<string, unknown> | null | undefined): string | null {
	if (!key || Object.keys(key).length === 0) return null;
	return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | undefined {
	if (!cursor) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		throw new CursorError("cursor invalid");
	}
}

export class CursorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CursorError";
	}
}
