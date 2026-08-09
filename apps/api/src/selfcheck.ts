/**
 * ponytail: assert room codes, discord payload, investigator, automation match.
 * Run: bun run --cwd apps/api check
 */
import assert from "node:assert/strict";
import { matchRule } from "./automation";
import { buildDiscordPayload, publicRoomUrl } from "./discord";
import { askIncident, investigate } from "./investigator";

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

assert.equal(matchRule({ metric: "errorRate", op: "gt", value: 8 }, { errorRate: 12, latencyMs: 40, queueDepth: 2, degradedPct: 10 }), true);
assert.equal(matchRule({ metric: "errorRate", op: "gt", value: 8 }, { errorRate: 2, latencyMs: 40, queueDepth: 2, degradedPct: 3 }), false);

const weak = investigate({
  title: "x",
  severity: "sev2",
  status: "investigating",
  affected: [],
  blastRoot: null,
  events: [],
});
assert.equal(weak.insufficient, true);

const strong = investigate({
  title: "API down",
  severity: "sev1",
  status: "investigating",
  affected: ["api", "db"],
  blastRoot: "api",
  events: [
    { id: "1", kind: "cascade.hop", summary: "api entered blast radius", createdAt: new Date() },
    { id: "2", kind: "metric.threshold", summary: "errorRate 12% > 8", createdAt: new Date() },
  ],
  latestMetrics: { errorRate: 12, latencyMs: 220, queueDepth: 30, degradedPct: 40 },
});
assert.equal(strong.insufficient, false);
assert.ok(strong.likelyRootCause);

const ask = askIncident("which services are affected?", {
  title: "API down",
  severity: "sev1",
  status: "investigating",
  affected: ["api", "db"],
  blastRoot: "api",
  events: [],
}, strong);
assert.match(ask.answer, /api/);

console.log("selfcheck ok");
