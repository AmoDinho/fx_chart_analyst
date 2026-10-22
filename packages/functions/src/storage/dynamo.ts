import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { decodeCursor, encodeCursor } from "./cursor";
import type { DocClient, IndexItem, IndexQuery } from "./types";

export class DynamoDocs implements DocClient {
	private readonly doc: DynamoDBDocumentClient;

	constructor(
		private readonly table: string,
		private readonly indexes: { gsi1: string; gsi2: string } = { gsi1: "gsi1", gsi2: "gsi2" },
		client?: DynamoDBDocumentClient,
	) {
		this.doc =
			client ??
			DynamoDBDocumentClient.from(new DynamoDBClient({}), {
				marshallOptions: { removeUndefinedValues: true },
			});
	}

	async get(pk: string, sk: string): Promise<IndexItem | null> {
		const result = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk, sk } }));
		return (result.Item as IndexItem | undefined) ?? null;
	}

	async put(item: IndexItem): Promise<void> {
		await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
	}

	async del(pk: string, sk: string): Promise<void> {
		await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
	}

	async query(input: IndexQuery): Promise<{ items: IndexItem[]; cursor: string | null }> {
		const names = keyNames(input);
		const values: Record<string, unknown> = { ":pk": input.pk };
		let condition = `#pk = :pk`;
		if (input.sk) {
			condition += " AND #sk = :sk";
			values[":sk"] = input.sk;
		} else if (input.skFrom && input.skTo) {
			condition += " AND #sk BETWEEN :from AND :to";
			values[":from"] = input.skFrom;
			values[":to"] = input.skTo;
		} else if (input.skFrom) {
			condition += " AND #sk >= :from";
			values[":from"] = input.skFrom;
		}
		const result = await this.doc.send(
			new QueryCommand({
				TableName: this.table,
				IndexName: indexName(input, this.indexes),
				KeyConditionExpression: condition,
				ExpressionAttributeNames: { "#pk": names.pk, "#sk": names.sk },
				ExpressionAttributeValues: values,
				ScanIndexForward: input.forward !== false,
				Limit: input.limit,
				ExclusiveStartKey: decodeCursor(input.cursor),
			}),
		);
		return {
			items: (result.Items as IndexItem[] | undefined) ?? [],
			cursor: encodeCursor(result.LastEvaluatedKey as Record<string, unknown> | undefined),
		};
	}
}

function keyNames(input: IndexQuery): { pk: string; sk: string } {
	if (input.index === "gsi1") return { pk: input.pkName ?? "gsi1pk", sk: input.skName ?? "gsi1sk" };
	if (input.index === "gsi2") return { pk: input.pkName ?? "gsi2pk", sk: input.skName ?? "gsi2sk" };
	return { pk: "pk", sk: "sk" };
}

function indexName(input: IndexQuery, indexes: { gsi1: string; gsi2: string }): string | undefined {
	if (input.index === "gsi1") return indexes.gsi1;
	if (input.index === "gsi2") return indexes.gsi2;
	return undefined;
}
