import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore, StoredObject } from "./types";

const PRESIGN_SECONDS = 15 * 60;

export class S3ObjectStore implements ObjectStore {
	private readonly client: S3Client;

	constructor(
		private readonly bucket: string,
		client?: S3Client,
	) {
		this.client = client ?? new S3Client({});
	}

	async get(key: string): Promise<StoredObject | null> {
		try {
			const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
			const body = await result.Body?.transformToByteArray();
			if (!body) return null;
			return {
				body,
				contentType: result.ContentType,
				metadata: result.Metadata ?? {},
			};
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
	}

	async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
		try {
			const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
			return { metadata: result.Metadata ?? {} };
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
	}

	async put(
		key: string,
		body: Uint8Array | string,
		opts?: { contentType?: string; metadata?: Record<string, string> },
	): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: typeof body === "string" ? body : body,
				ContentType: opts?.contentType,
				Metadata: opts?.metadata,
			}),
		);
	}

	async copy(from: string, to: string): Promise<void> {
		await this.client.send(
			new CopyObjectCommand({
				Bucket: this.bucket,
				CopySource: `${this.bucket}/${from}`,
				Key: to,
				MetadataDirective: "COPY",
			}),
		);
	}

	async delete(key: string): Promise<void> {
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
	}

	async presignGet(key: string, expiresSeconds = PRESIGN_SECONDS): Promise<string> {
		return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
			expiresIn: expiresSeconds,
		});
	}
}

function isMissing(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const name = "name" in error ? String(error.name) : "";
	const status = "$metadata" in error ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
	return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
