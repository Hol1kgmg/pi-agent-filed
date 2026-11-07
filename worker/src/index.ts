export { Session } from "./session";
export { Sandbox } from "./sandbox/container";
export { Egress } from "./sandbox/egress";

const route = /^\/goals\/([A-Za-z0-9_-]{1,64})$/;

/** Constant-time compare, so the token cannot be guessed byte by byte from response timing. */
async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false;
  const given = request.headers.get("authorization") ?? "";
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(`Bearer ${token}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
