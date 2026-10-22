export type StoredObject = {
	body: Uint8Array;
	contentType?: string;
	metadata: Record<string, string>;
};

export type ObjectStore = {
	get(key: string): Promise<StoredObject | null>;
	head(key: string): Promise<{ metadata: Record<string, string> } | null>;
	put(
		key: string,
		body: Uint8Array | string,
		opts?: { contentType?: string; metadata?: Record<string, string> },
	): Promise<void>;
	copy(from: string, to: string): Promise<void>;
	delete(key: string): Promise<void>;
	presignGet(key: string, expiresSeconds?: number): Promise<string>;
};

export type IndexItem = Record<string, unknown> & { pk: string; sk: string };

export type IndexQuery = {
	index?: "base" | "gsi1" | "gsi2";
	pkName?: string;
	skName?: string;
	pk: string;
	sk?: string;
	skFrom?: string;
	skTo?: string;
	limit?: number;
	cursor?: string | null;
	forward?: boolean;
};

export type DocClient = {
	get(pk: string, sk: string): Promise<IndexItem | null>;
	put(item: IndexItem): Promise<void>;
	query(input: IndexQuery): Promise<{ items: IndexItem[]; cursor: string | null }>;
	del(pk: string, sk: string): Promise<void>;
};
