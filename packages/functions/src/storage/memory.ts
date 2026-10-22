import { decodeCursor, encodeCursor } from "./cursor";
import type { DocClient, IndexItem, IndexQuery, ObjectStore, StoredObject } from "./types";

export class MemoryObjects implements ObjectStore {
	readonly objects = new Map<string, StoredObject>();

	async get(key: string): Promise<StoredObject | null> {
		return this.objects.get(key) ?? null;
	}

	async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
		const found = this.objects.get(key);
		return found ? { metadata: found.metadata } : null;
	}

	async put(
		key: string,
		body: Uint8Array | string,
		opts?: { contentType?: string; metadata?: Record<string, string> },
	): Promise<void> {
		const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
		this.objects.set(key, {
			body: bytes,
			contentType: opts?.contentType,
			metadata: opts?.metadata ?? {},
		});
	}

	async copy(from: string, to: string): Promise<void> {
		const found = this.objects.get(from);
		if (!found) throw new Error(`missing object ${from}`);
		this.objects.set(to, {
			body: found.body,
			contentType: found.contentType,
			metadata: { ...found.metadata },
		});
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}

	async presignGet(key: string, expiresSeconds = 900): Promise<string> {
		return `https://artifacts.example/${key}?exp=${expiresSeconds}`;
	}
}

export class MemoryDocs implements DocClient {
	readonly items: IndexItem[] = [];

	async get(pk: string, sk: string): Promise<IndexItem | null> {
		return this.items.find((item) => item.pk === pk && item.sk === sk) ?? null;
	}

	async put(item: IndexItem): Promise<void> {
		const index = this.items.findIndex((row) => row.pk === item.pk && row.sk === item.sk);
		if (index >= 0) this.items[index] = item;
		else this.items.push(item);
	}

	async del(pk: string, sk: string): Promise<void> {
		const index = this.items.findIndex((item) => item.pk === pk && item.sk === sk);
		if (index >= 0) this.items.splice(index, 1);
	}

	async query(input: IndexQuery): Promise<{ items: IndexItem[]; cursor: string | null }> {
		const pkName = input.pkName ?? (input.index === "gsi1" ? "gsi1pk" : input.index === "gsi2" ? "gsi2pk" : "pk");
		const skName = input.skName ?? (input.index === "gsi1" ? "gsi1sk" : input.index === "gsi2" ? "gsi2sk" : "sk");
		let rows = this.items.filter((item) => item[pkName] === input.pk);
		if (input.sk) rows = rows.filter((item) => item[skName] === input.sk);
		if (input.skFrom) rows = rows.filter((item) => String(item[skName] ?? "") >= input.skFrom!);
		if (input.skTo) rows = rows.filter((item) => String(item[skName] ?? "") <= input.skTo!);
		rows.sort((a, b) => String(a[skName] ?? "").localeCompare(String(b[skName] ?? "")));
		if (input.forward === false) rows.reverse();
		const start = cursorOffset(input.cursor);
		const limit = input.limit ?? rows.length;
		const page = rows.slice(start, start + limit);
		const next = start + limit < rows.length ? encodeCursor({ offset: start + limit }) : null;
		return { items: page, cursor: next };
	}
}

function cursorOffset(cursor: string | null | undefined): number {
	const decoded = decodeCursor(cursor);
	const offset = decoded?.offset;
	return typeof offset === "number" ? offset : 0;
}
