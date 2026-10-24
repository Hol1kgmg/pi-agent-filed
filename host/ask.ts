// Ask the root conversation one question; the transcript lives in SQLite, so later runs continue it.
// Run from host/: node --experimental-strip-types ask.ts [question]
// Without a question, it only finishes inputs an earlier run left unanswered.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
	AssistantEntry,
	createRegistry,
	defineExtension,
	Harness,
	LiveDoc,
	type Submission,
	section,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { dir, fileCredentialStore } from "./auth.ts";

const context = BACKGROUND_CONTEXT;
const question = process.argv.slice(2).join(" ");

const models = createModels({ credentials: fileCredentialStore });
models.setProvider(openaiProvider());
if ((await models.checkAuth("openai")) === undefined) {
	console.log("skipped: not logged in (run login.ts)");
	process.exit(1);
}
const registry = createRegistry();
registry.install(
	defineExtension({
		name: "concise",
		sections: [section("preamble", () => "You are a concise assistant.", { tag: false })],
	}),
);

mkdirSync(dir, { recursive: true, mode: 0o700 });
const harness = await Harness.open(await openNodeSqliteStorage(join(dir, "session.sqlite")), { models, registry }, context);
const root = await harness.root(context, { agent: { model: { provider: "openai", modelId: "gpt-6.1-sol" } } });

let printed = "";
const printText = (text: string): void => {
	// A killed run's leftover partial or a retried attempt does not extend what was printed; start over instead of dropping the new answer.
	if (!text.startsWith(printed)) {
		if (printed !== "") process.stdout.write("\n--- regenerated ---\n");
		printed = "";
	}
	if (text.length <= printed.length) return;
	process.stdout.write(text.slice(printed.length));
	printed = text;
};
const liveWatch = (await harness.watchDoc(LiveDoc, root.id, context))!;
liveWatch.start(async (value) => {
	const block = value?.generation?.message?.content.find((content) => content.type === "text");
	if (block?.type === "text") printText(block.text);
});

const answer = async (submission: Submission): Promise<void> => {
	printed = "";
	const settled = await submission.wait(context);
	if (settled.status === "done" && settled.type === "input") {
		// The last throttle window may not have been committed as a partial; the answer entry has the rest.
		const entry = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
		const message = entry?.model?.[0];
		const block = message?.role === "assistant" ? message.content.find((content) => content.type === "text") : undefined;
		if (block?.type === "text") printText(block.text);
		process.stdout.write("\n");
	} else {
		console.log("unanswered:", settled.reason, settled.detail);
	}
};

try {
	for (const record of (await harness.inspect(context)).submissions) {
		if (record.conversationId !== root.id || record.type !== "input") continue;
		console.log(`resuming submission ${record.id}`);
		await answer((await harness.submission(record.id, context))!);
	}
	if (question !== "") await answer(await root.submit({ type: "input", content: question }, context));
} finally {
	await liveWatch.stop();
	await harness.close(context);
}
