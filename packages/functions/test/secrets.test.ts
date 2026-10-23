import assert from "node:assert/strict";
import test from "node:test";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { clearSecretCache, readSecretString } from "../src/secrets";

test("reads the current Secrets Manager string and does not echo it in errors", async () => {
	clearSecretCache();
	const mock = mockClient(SecretsManagerClient);
	mock.on(GetSecretValueCommand).resolves({ SecretString: "sk-test-value" });
	const client = new SecretsManagerClient({});
	assert.equal(await readSecretString("arn:aws:secretsmanager:eu-west-1:1:secret:deepseek", client), "sk-test-value");
	assert.equal(mock.commandCalls(GetSecretValueCommand).length, 1);
	assert.equal(await readSecretString("arn:aws:secretsmanager:eu-west-1:1:secret:deepseek", client), "sk-test-value");
	assert.equal(mock.commandCalls(GetSecretValueCommand).length, 1);

	clearSecretCache();
	mock.reset();
	mock.on(GetSecretValueCommand).rejects({ name: "ResourceNotFoundException" });
	await assert.rejects(readSecretString("missing", new SecretsManagerClient({})), (error: unknown) => {
		assert.match(String(error), /ResourceNotFoundException/);
		assert.equal(String(error).includes("sk-test-value"), false);
		return true;
	});
	mock.restore();
});
