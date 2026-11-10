import { WorkerEntrypoint } from "cloudflare:workers";

const GITHUB_HOSTS = new Set(["api.github.com", "github.com", "codeload.github.com"]);
const REFRESH_BEFORE_MS = 5 * 60_000;

let cached: { token: string; expiresAt: number } | undefined;

const base64url = (bytes: Uint8Array | string): string =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** WebCrypto reads only PKCS#8, so the App's PKCS#1 key is converted once with `openssl pkcs8 -topk8 -nocrypt`. */
async function appJwt(appId: string, pem: string): Promise<string> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  // Backdated a minute: GitHub rejects an `iat` ahead of its own clock.
  const body = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

/** An installation token for the work repository only, and only for contents and pull requests. */
async function installationToken(env: Env): Promise<string> {
  if (cached && cached.expiresAt - REFRESH_BEFORE_MS > Date.now()) return cached.token;
  const response = await fetch(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY)}`,
      accept: "application/vnd.github+json",
      "user-agent": "pi-agent-filed",
    },
    body: JSON.stringify({
      repositories: [env.GITHUB_REPOSITORY.split("/")[1]],
      permissions: { contents: "write", pull_requests: "write" },
    }),
  });
  if (!response.ok) throw new Error(`github_token_${response.status}`);
  const { token, expires_at } = (await response.json()) as { token: string; expires_at: string };
  cached = { token, expiresAt: Date.parse(expires_at) };
  return token;
}

/** Outbound handler of every sandbox container: the only place a GitHub credential is used. */
export class Egress extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const host = new URL(request.url).hostname;
    if (!GITHUB_HOSTS.has(host) || !this.env.GITHUB_APP_ID) return fetch(request);
    let token: string;
    try {
      token = await installationToken(this.env);
    } catch (error) {
      // The container learns only that the token was refused, not the App's setup.
      console.error("github_token_failed", String(error));
      return new Response("github_token_failed", { status: 502 });
    }
    const headers = new Headers(request.headers);
    headers.set(
      "authorization",
      host === "api.github.com" ? `Bearer ${token}` : `Basic ${btoa(`x-access-token:${token}`)}`,
    );
    return fetch(new Request(request, { headers }));
  }
}
