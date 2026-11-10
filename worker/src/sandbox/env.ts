import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { RemoteExecutionEnv } from "@earendil-works/pi-env";
import { asConnection, ContainerConnection } from "./connection";
import { TRUST_ENV } from "./image";

/** Pi's own `read`, `write`, `edit` and `bash` run in the goal's container, reached through pi-env. */
export function sandbox(env: Env, goal: () => string) {
  let connection: ContainerConnection | undefined;
  const stub = () => env.SANDBOX.getByName(goal());
  return {
    env: (): ExecutionEnv =>
      new RemoteExecutionEnv({
        connection: asConnection((connection ??= new ContainerConnection((token) => stub().daemon(token)))),
        id: `sandbox:${goal()}`,
        cwd: "/workspace",
        shellEnv: { ...TRUST_ENV },
      }),
    checkpoint: () => stub().checkpoint(),
  };
}
