// Run from host/: PI_AGENT_FILED_HOME=$(mktemp -d) node --experimental-strip-types auth.check.ts
import assert from "node:assert/strict";
import { fileCredentialStore as store, getDeviceId } from "./auth.ts";

await Promise.all([
	store.modify("a", async () => ({ type: "api_key", key: "1" })),
	store.modify("b", async () => ({ type: "api_key", key: "2" })),
]);
assert.equal((await store.list()).length, 2, "concurrent modify keeps both writes");

await store.delete("a");
assert.equal(await store.read("a"), undefined);
assert.deepEqual(await store.read("b"), { type: "api_key", key: "2" });

assert.equal(getDeviceId(), getDeviceId(), "device ID stays the same");
console.log("ok");
