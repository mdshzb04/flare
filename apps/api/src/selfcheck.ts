/**
 * ponytail: one assert-based self-check — fails if room code / serialize shape breaks.
 * Run: bun run --cwd apps/api check (needs no DB).
 */
import assert from "node:assert/strict";
import { buildDiscordPayload, publicRoomUrl } from "./discord";

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

const down = buildDiscordPayload("down", "abc12345", {
  title: "API latency spike",
  severity: "sev1",
  status: "identified",
  affected: ["api", "db"],
  blastRoot: "api",
});
assert.match(String(down.content), /cascade started/);
assert.ok(JSON.stringify(down).includes(publicRoomUrl("abc12345")));

const clear = buildDiscordPayload("clear", "abc12345", {
  title: "API latency spike",
  severity: "sev1",
  status: "resolved",
  affected: [],
});
assert.match(String(clear.content), /all clear/);

console.log("selfcheck ok");
