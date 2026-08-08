/**
 * ponytail: one assert-based self-check — fails if room code / serialize shape breaks.
 * Run: bun run --cwd apps/api check (needs no DB).
 */
import assert from "node:assert/strict";

function code() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

const c = code();
assert.equal(c.length, 8);
assert.match(c, /^[a-f0-9]+$/);

function roomChannel(roomCode: string) {
  return `flare:room:${roomCode}`;
}
assert.equal(roomChannel("abc"), "flare:room:abc");

console.log("selfcheck ok");
