import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, type Wake } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { createAgentOptions, textOf } from "./agent";
import { sandbox } from "./sandbox/env";

/** While work can run, the alarm stays this far ahead, so an evicted instance is woken to resume it. */
const HEARTBEAT_MS = 60_000;

export type SlackThread = { channel: string; ts: string };

/** One goal: its Harness and session DB. */
export class Session extends DurableObject<Env> {
  #harness!: Harness;
  #goal: string | undefined;
  #alarmWrites: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.#initialize());
  }

  async #initialize(): Promise<void> {
    // A fallback before anything can throw: an object whose open or recovery fails is started again.
    const fallback = Date.now() + HEARTBEAT_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > fallback) await this.ctx.storage.setAlarm(fallback);

    this.#goal = await this.ctx.storage.get<string>("goal");
    const box = sandbox(this.env, () => this.#goal!);
    const harness = await Harness.open(
      await openDurableObjectSqliteStorage(this.ctx.storage),
      {
        ...createAgentOptions(this.env, box, (text) => this.#reply(text)),
        onReport: ({ error, ...info }) => console.error("harness_report", String(error), JSON.stringify(info)),
        onWake: (wake) => void this.#arm(wake).catch(() => this.ctx.abort("Alarm write failed")),
      },
      BACKGROUND_CONTEXT,
    );
    void harness.closed.then((end) => {
      if (end.kind === "failed") this.ctx.abort("Harness failed");
    });
    this.#harness = harness;
    await this.#arm(harness.wake());
    harness.resume();
  }

  async submit(goal: string, requestId: string, input: string, thread?: SlackThread): Promise<{ submissionId: number }> {
    if (this.#goal === undefined) {
      await this.ctx.storage.put(thread ? { goal, slack: thread } : { goal });
      this.#goal = goal;
    }
    // Arm before admitting work: an instance that dies before `onWake` runs is still woken.
    await this.#arm({ ...this.#harness.wake(), active: true });
    const root = await this.#harness.root(BACKGROUND_CONTEXT);
    const submission = await root.submit(
      { type: "input", content: input, requestId, whenBusy: "followUp" },
      BACKGROUND_CONTEXT,
    );
    return { submissionId: submission.id };
  }

  async show(limit: number): Promise<{ pending: number; entries: { kind: string; text: string }[] }> {
    const root = await this.#harness.root(BACKGROUND_CONTEXT);
    const page = await root.entries({}, limit, undefined, BACKGROUND_CONTEXT);
    const pending = (await this.#harness.inspect(BACKGROUND_CONTEXT)).submissions.length;
    const entries = page.items
      .toReversed()
      .map((entry) => ({ kind: entry.kind, text: (entry.model ?? []).map((m) => textOf(m.content as never) || (m as { errorMessage?: string }).errorMessage || "").join("\n") }))
      .filter((entry) => entry.text !== "");
    return { pending, entries };
  }

  async #reply(text: string): Promise<void> {
    const thread = await this.ctx.storage.get<SlackThread>("slack");
    if (thread === undefined || text === "") return;
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: thread.channel, thread_ts: thread.ts, markdown_text: text }),
    });
    const result = (await response.json().catch(() => ({ ok: false, error: `http ${response.status}` }))) as { ok: boolean; error?: string };
    // ponytail: a failed post is only logged; add an outbox with retries if replies go missing.
    if (!result.ok) console.error("slack_post_failed", result.error);
  }

  override async alarm(): Promise<void> {
    await this.#arm({ ...this.#harness.wake(), active: true });
    this.#harness.resume();
    // Alarms are at-least-once: re-arm from the actual wake so a spurious one leaves no heartbeat behind.
    await this.#arm(this.#harness.wake());
  }

  /** The one alarm: the earliest sleep, or a recovery heartbeat while work can run, whichever comes first. */
  #arm(wake: Wake): Promise<void> {
    // Serialized, so an older wake cannot overwrite a newer, earlier deadline.
    const write = this.#alarmWrites.then(async () => {
      const heartbeat = wake.active ? Date.now() + HEARTBEAT_MS : undefined;
      const at = heartbeat === undefined || wake.at === undefined ? (heartbeat ?? wake.at) : Math.min(heartbeat, wake.at);
      if (at === undefined) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(at);
    });
    this.#alarmWrites = write.catch(() => undefined);
    return write;
  }
}
