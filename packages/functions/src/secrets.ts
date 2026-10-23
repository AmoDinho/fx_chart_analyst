import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const cache = new Map<string, string>();

export function clearSecretCache(): void {
	cache.clear();
}

/** Read one Secrets Manager string. The value is never included in the thrown error. */
export async function readSecretString(secretId: string, client = new SecretsManagerClient({})): Promise<string> {
	const cached = cache.get(secretId);
	if (cached) return cached;
	let value = "";
	try {
		const result = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: "AWSCURRENT" }));
		value = result.SecretString?.trim() ?? "";
	} catch (error) {
		const name = error && typeof error === "object" && "name" in error ? String(error.name) : "SecretsManager";
		throw new Error(`DeepseekApiKey could not be read from Secrets Manager (${name}). Set the AWSCURRENT value; the key itself is not logged.`);
	}
	if (!value) throw new Error("DeepseekApiKey secret has no AWSCURRENT string value.");
	cache.set(secretId, value);
	return value;
}

export async function readDeepseekApiKey(secretId = process.env.DEEPSEEK_SECRET_ID): Promise<string> {
	if (!secretId) throw new Error("DEEPSEEK_SECRET_ID is not set. The workflow must be linked to the Secrets Manager secret.");
	return readSecretString(secretId);
}
