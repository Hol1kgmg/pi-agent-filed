// Sign in with ChatGPT and store the credential for the openai provider.
// Run from host/: node --experimental-strip-types login.ts
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { fileCredentialStore, getDeviceId } from "./auth.ts";

const models = createModels({ credentials: fileCredentialStore });
models.setProvider(openaiProvider());

const rl = createInterface({ input: stdin, output: stdout });
try {
	await models.login(
		"openai",
		"oauth",
		{
			prompt: ({ message, signal }) => rl.question(`${message} `, { signal }),
			notify: (event) => console.log(event.type === "auth_url" ? `${event.instructions ?? ""}\n${event.url}` : "message" in event ? event.message : event),
		},
		{ getDeviceId, agentName: "pi-agent-filed" },
	);
	console.log("logged in:", await fileCredentialStore.list());
} finally {
	rl.close();
}
