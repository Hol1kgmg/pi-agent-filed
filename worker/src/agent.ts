import { createModels } from "@earendil-works/pi-ai/models";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";
import { configure, createRegistry, defineExtension, hook, ToolTask, type HarnessOptions } from "@earendil-works/pi-durable";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import { checkpointToolResult } from "./sandbox/checkpoint";
import type { sandbox } from "./sandbox/env";

const INSTRUCTIONS =
  "You are the PO of a small development team. For now you work alone: you agree on a goal with the developer, " +
  "then do the work yourself in your Linux sandbox. read, write, edit and bash run in a container, and your files are under /workspace. " +
  "Keep replies short. Answer in the language of the developer's message.";

export function createAgentOptions(env: Env, box: ReturnType<typeof sandbox>): HarnessOptions {
  const models = createModels({
    authContext: { env: async (name) => (env as unknown as Record<string, string | undefined>)[name], fileExists: async () => false },
  });
  models.setProvider(cloudflareWorkersAIProvider());
  const registry = createRegistry();
  registry.install(createCodingTools());
  registry.install(
    defineExtension({
      name: "workspace",
      hooks: [hook(ToolTask, { afterTool: (call, result) => checkpointToolResult(call.name, result, box.checkpoint) })],
    }),
  );
  return {
    models,
    registry,
    env: () => box.env(),
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, {
            model: { provider: "cloudflare-workers-ai", modelId: "@cf/deepseek-ai/deepseek-v4.1-flash-1017" },
            instructions: INSTRUCTIONS,
          })
        : undefined,
  };
}
