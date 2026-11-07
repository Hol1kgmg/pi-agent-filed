import { DurableObject } from "cloudflare:workers";
import type { Duplex } from "./connection";
import { startupOptions, TRUST_ENV } from "./image";
import { serial } from "../serial";

/** Internal binding only: do not expose this DO's RPC through a public HTTP route. */
export class Sandbox extends DurableObject<Env> {
  private readonly exclusive = serial();

  /** Opens the pi-env daemon in this goal's container, starting the container if needed. */
  async daemon(token: string): Promise<Duplex> {
    return this.exclusive(async () => {
      const container = this.ctx.container;
      if (!container) throw new Error("sandbox_unconfigured");
      if (!container.running) {
        const snapshot = await this.ctx.storage.get<ContainerSnapshot>("snapshot");
        container.start(startupOptions(snapshot));
      }
      // Intercepts last until the container stops, so they are registered again every time.
      const egress = (this.ctx.exports as unknown as Record<string, (init: object) => Fetcher>).Egress!({});
      await container.interceptOutboundHttps("*", egress);
      await container.interceptOutboundHttp("*", egress);
      await (await container.exec(["mkdir", "-p", "/workspace"])).exitCode;
      const daemon = await container.exec(["pi-env", "serve", "--token", token], {
        cwd: "/workspace",
        env: { ...TRUST_ENV },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      });
      return { stdin: daemon.stdin!, stdout: daemon.stdout! };
    });
  }

  /** False when the container is not running: its files are already the last snapshot's, or lost with it. */
  checkpoint(): Promise<boolean> {
    return this.exclusive(async () => {
      if (!this.ctx.container?.running) return false;
      await this.snapshot();
      return true;
    });
  }

  private async snapshot(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("sandbox_unconfigured");
    const snapshot = await container.snapshotContainer({ name: "workspace" });
    await this.ctx.storage.put("snapshot", snapshot);
    console.info("sandbox_checkpoint_saved", { id: snapshot.id, size: snapshot.size });
  }
}
