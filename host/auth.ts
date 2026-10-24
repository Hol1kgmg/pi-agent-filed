import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

// The agent's shell runs in the devcontainer and must not be able to read tokens, so keep them outside the repo.
export const dir = process.env.PI_AGENT_FILED_HOME ?? join(homedir(), ".config", "pi-agent-filed");
const credentialsPath = join(dir, "credentials.json");
const deviceIdPath = join(dir, "device-id");

function readJson(): Record<string, Credential> {
	try {
		return JSON.parse(readFileSync(credentialsPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function writeJson(credentials: Record<string, Credential>): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

// ponytail: in-process lock only; add a file lock if two host processes ever share the store.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
	const run = chain.then(task);
	chain = run.catch(() => {});
	return run;
}

export const fileCredentialStore: CredentialStore = {
	async read(providerId) {
		return readJson()[providerId];
	},
	async list() {
		return Object.entries(readJson()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	},
	modify(providerId, fn) {
		return serialize(async () => {
			const credentials = readJson();
			const next = await fn(credentials[providerId]);
			if (next === undefined) return credentials[providerId];
			writeJson({ ...credentials, [providerId]: next });
			return next;
		});
	},
	delete(providerId) {
		return serialize(async () => {
			const { [providerId]: _, ...rest } = readJson();
			writeJson(rest);
		});
	},
};

// Sign in with ChatGPT identifies the installation by this ID and requires it to stay the same across logins.
export function getDeviceId(): string {
	try {
		return readFileSync(deviceIdPath, "utf8").trim();
	} catch {
		const id = randomUUID();
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(deviceIdPath, id, { mode: 0o600 });
		return id;
	}
}
