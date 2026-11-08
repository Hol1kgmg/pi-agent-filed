/** Snapshot restores keep the original filesystem; only fresh workspaces start from the image. */
export function startupOptions(image: string, snapshot: ContainerSnapshot | undefined): ContainerStartupOptions {
  return {
    ...(snapshot ? { containerSnapshot: snapshot } : { image }),
    entrypoint: ["sleep", "infinity"],
    enableInternet: true,
    env: {},
    // The ~1GB workspace snapshot plus npm builds need more than the default lite instance.
    instance: { vcpu: 1, memoryMib: 4096, diskMb: 16000 },
  };
}

/** The CA the platform injects once HTTPS interception is on; every client has to trust it. */
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
/**
 * Why replace rather than extend the trust store: every HTTPS request is intercepted (see `container.ts`),
 * so the platform's CA is the only one that can validate any of them.
 */
export const TRUST_ENV = {
  SSL_CERT_FILE: CA,
  CURL_CA_BUNDLE: CA,
  GIT_SSL_CAINFO: CA,
  NODE_EXTRA_CA_CERTS: CA,
  REQUESTS_CA_BUNDLE: CA,
  // PATH is added by the platform; HOME keeps package-manager caches under /tmp.
  HOME: "/tmp",
  CI: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_HTTP_LOW_SPEED_LIMIT: "1024",
  GIT_HTTP_LOW_SPEED_TIME: "60",
} as const;
