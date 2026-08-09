/**
 * ponytail: assert room codes, discord payload, investigator, automation match.
 * Run: bun run --cwd apps/api check
 */
import assert from "node:assert/strict";
import { isBlockedIp } from "./checkUrl";
import { matchRule } from "./automation";
import { buildDiscordAlert, buildDiscordPayload, publicRoomUrl } from "./discord";
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
  metrics: { errorRate: 42.1, availability: 0.579, latencyMs: 3800 },
  impact: "HTTP 500 responses",
});
assert.match(String(down.content), /CRITICAL INCIDENT|FLARE INCIDENT/);
assert.ok(JSON.stringify(down).includes(publicRoomUrl("abc12345")));
assert.ok(JSON.stringify(down).includes("Open War Room"));
assert.ok(JSON.stringify(down).includes("42.1%"));
assert.ok(!JSON.stringify(down).includes("localhost"));

const created = buildDiscordAlert("incident.created", "inc7f31", {
  title: "shop-api degradation detected",
  severity: "sev2",
  status: "investigating",
  affected: ["shop-api"],
  blastRoot: "shop-api",
  metrics: { errorRate: 18.4, availability: 0.816, latencyMs: 2400 },
  impact: "HTTP 500 errors detected",
});
assert.match(created.content, /FLARE INCIDENT/);
assert.ok(created.embeds[0].fields.some((f) => f.name === "Evidence"));

const resolved = buildDiscordAlert("incident.resolved", "inc7f31", {
  title: "shop-api degradation detected",
  severity: "sev2",
  status: "resolved",
  affected: ["shop-api"],
  blastRoot: "shop-api",
  startedAt: new Date(Date.now() - 161_000),
  alertVariant: "resolved",
  metrics: { errorRate: 1.2, availability: 1, latencyMs: 40 },
});
assert.match(resolved.content, /INCIDENT RESOLVED/);

const allClear = buildDiscordAlert("incident.resolved", "inc7f31", {
  title: "shop-api degradation detected",
  severity: "sev2",
  status: "resolved",
  affected: ["shop-api"],
  blastRoot: "shop-api",
  alertVariant: "all_clear",
  startedAt: new Date(Date.now() - 161_000),
});
assert.match(allClear.content, /ALL CLEAR/);

const testAlert = buildDiscordAlert("test", "test", {
  title: "t",
  severity: "sev4",
  status: "ok",
  affected: [],
});
assert.match(testAlert.content, /DISCORD TEST/);

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
assert.match(weak.message || "", /Insufficient evidence/);
assert.equal(
  askIncident("why did this happen?", {
    title: "x",
    severity: "sev2",
    status: "investigating",
    affected: [],
    blastRoot: null,
    events: [],
  }, weak).answer,
  "Insufficient evidence to determine the root cause.",
);

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

assert.equal(isBlockedIp("127.0.0.1"), true);
assert.equal(isBlockedIp("10.0.0.1"), true);
assert.equal(isBlockedIp("192.168.1.1"), true);
assert.equal(isBlockedIp("169.254.169.254"), true);
assert.equal(isBlockedIp("8.8.8.8"), false);

console.log("selfcheck ok");
