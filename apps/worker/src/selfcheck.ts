/**
 * ponytail: assert load-sim math — healthy low, api-down spikes.
 * Run: bun run --cwd apps/worker check
 */
import assert from "node:assert/strict";
import { isDegraded, isRecovered, type LiveSnap } from "./liveMonitor";
import { degradedPct, newRoomSim, stress, tickRoom } from "./metrics";

const baseLive: LiveSnap = {
  errorRate: 0,
  latencyMs: 40,
  queueDepth: 0,
  degradedPct: 0,
  rps: 1,
  requestCount: 10,
  errorCount: 0,
  availability: 1,
  source: "live",
  label: "LIVE",
  ts: 0,
  windowSec: 120,
};
assert.equal(isDegraded({ ...baseLive, errorRate: 40, availability: 0.5 }), true);
assert.equal(isRecovered(baseLive), true);

assert.equal(stress([]), 0);
assert.ok(stress(["api"]) >= 1);
assert.ok(stress(["api", "db"]) > stress(["api"]));

const healthy = degradedPct(0, 0.5, 55, 2);
assert.ok(healthy < 25, `healthy degraded=${healthy}`);

const down = degradedPct(4, 25, 400, 50);
assert.ok(down > healthy, `down=${down} healthy=${healthy}`);
assert.ok(down > 40, `expected clear spike, got ${down}`);

const sim = newRoomSim([]);
const a = tickRoom(sim, 1_000, () => 0.5);
const b = tickRoom(sim, 2_000, () => 0.5);
assert.ok(b.reqTotal > a.reqTotal, "reqTotal must climb");
assert.equal(a.type, "metrics");
assert.equal(a.source, "demo");

sim.affected = ["api"];
let last = a.errorRate;
for (let i = 0; i < 8; i++) last = tickRoom(sim, 3_000 + i * 1000, () => 0.5).errorRate;
assert.ok(last > a.errorRate * 2, `errorRate should spike after api down (${last} vs ${a.errorRate})`);

console.log("worker selfcheck ok");
