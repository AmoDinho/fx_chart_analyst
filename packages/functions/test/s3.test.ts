import assert from "node:assert/strict";
import test from "node:test";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3ObjectStore } from "../src/storage/s3";

test("s3 adapter writes metadata and reads it back from head", async () => {
	const mock = mockClient(S3Client);
	mock.on(HeadObjectCommand).resolves({ Metadata: { hash: "abc", width: "800", height: "400", verified: "true" } });
	mock.on(PutObjectCommand).resolves({});
	const store = new S3ObjectStore("artifacts", new S3Client({}));
	const head = await store.head("gold/1D/2026-10-22.png");
	assert.equal(head?.metadata.hash, "abc");
	assert.equal(head?.metadata.verified, "true");
	await store.put("gold/1D/2026-10-22.png", new Uint8Array([1, 2, 3]), {
		contentType: "image/png",
		metadata: { hash: "abc", width: "800", height: "400", verified: "true" },
	});
	const call = mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
	assert.equal(call?.Bucket, "artifacts");
	assert.equal(call?.Metadata?.hash, "abc");
	mock.restore();
});

test("missing s3 objects are empty rather than thrown", async () => {
	const mock = mockClient(S3Client);
	mock.on(HeadObjectCommand).rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
	const store = new S3ObjectStore("artifacts", new S3Client({}));
	assert.equal(await store.head("missing.png"), null);
	mock.restore();
});
