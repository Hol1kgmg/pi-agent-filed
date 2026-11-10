export { Session } from "./session";
export { Workspace } from "./sandbox/container";
export { Egress } from "./sandbox/egress";

const route = /^\/goals\/([A-Za-z0-9_-]{1,64})$/;
const encoder = new TextEncoder();

/** Constant-time compare, so a secret cannot be guessed byte by byte from response timing. */
async function same(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false;
  return same(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

/** https://docs.slack.dev/authentication/verifying-requests-from-slack */
async function signedBySlack(request: Request, body: string, secret: string | undefined): Promise<boolean> {
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  if (!secret || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`)));
  const hex = Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return same(request.headers.get("x-slack-signature") ?? "", `v0=${hex}`);
}

type SlackEvent = { type?: string; user?: string; bot_id?: string; text?: string; channel?: string; ts?: string; thread_ts?: string };

async function slack(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!(await signedBySlack(request, body, env.SLACK_SIGNING_SECRET))) return new Response("unauthorized", { status: 401 });
  const payload = JSON.parse(body) as { type?: string; challenge?: string; event_id?: string; event?: SlackEvent };
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });

  const event = payload.event;
  const allowed = (env.SLACK_ALLOWED_USERS ?? "").split(",").map((user) => user.trim());
  if (
    payload.type !== "event_callback" || event?.type !== "app_mention" || event.bot_id !== undefined ||
    !event.user || !allowed.includes(event.user) || !event.channel || !event.ts || !payload.event_id
  )
    return new Response(null, { status: 200 });

  const thread = { channel: event.channel, ts: event.thread_ts ?? event.ts };
  const goal = `${thread.channel}-${thread.ts.replace(".", "_")}`;
  // Slack escapes only these three; &amp; goes last so "&amp;lt;" stays "&lt;".
  const input = (event.text ?? "")
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  if (input === "") return new Response(null, { status: 200 });
  // Slack resends an event it got no 200 for within 3 seconds with the same event_id, which the submission dedupes.
  await env.SESSIONS.getByName(goal).submit(goal, payload.event_id, input, thread);
  return new Response(null, { status: 200 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/slack/events" && request.method === "POST") return slack(request, env);
    if (!(await authorized(request, env.WEBHOOK_TOKEN))) return new Response("unauthorized", { status: 401 });
    const goal = route.exec(new URL(request.url).pathname)?.[1];
    if (goal === undefined) return new Response("not found", { status: 404 });
    const session = env.SESSIONS.getByName(goal);

    if (request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { requestId?: unknown; input?: unknown } | null;
      if (typeof body?.requestId !== "string" || typeof body.input !== "string" || body.input === "")
        return new Response("body must be {requestId, input}", { status: 400 });
      return Response.json(await session.submit(goal, body.requestId, body.input), { status: 202 });
    }
    if (request.method === "GET") return Response.json(await session.show(30));
    return new Response("method not allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
