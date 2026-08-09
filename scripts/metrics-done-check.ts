/**
 * Done-check: two WS clients see ticking metrics; api-down spikes both.
 * Requires: api + worker + redis (+ db for room create).
 * Run: bun run scripts/metrics-done-check.ts
 */
const API = process.env.API || "http://127.0.0.1:3000";
const WS = process.env.WS || "ws://127.0.0.1:3000/ws";

type Metrics = {
  type: string;
  errorRate: number;
  latencyMs: number;
  degradedPct: number;
  reqTotal: number;
  ts: number;
};

function waitMetrics(ws: WebSocket, n: number, timeoutMs = 8000): Promise<Metrics[]> {
  const out: Metrics[] = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${n} metrics (got ${out.length})`)), timeoutMs);
    ws.addEventListener("message", (ev) => {
      let msg: Metrics;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type !== "metrics") return;
      out.push(msg);
      if (out.length >= n) {
        clearTimeout(t);
        resolve(out);
      }
    });
  });
}

function openWs(room: string, name: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?room=${room}&name=${encodeURIComponent(name)}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`ws failed ${name}`));
  });
}

const create = await fetch(`${API}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "metrics done-check" }),
});
if (!create.ok) throw new Error(`create room ${create.status}`);
const { code } = (await create.json()) as { code: string };

const a = await openWs(code, "tab-a");
const b = await openWs(code, "tab-b");

const [ticksA, ticksB] = await Promise.all([waitMetrics(a, 3), waitMetrics(b, 3)]);
if (!(ticksA[2].reqTotal > ticksA[0].reqTotal)) {
  throw new Error("tab-a reqTotal did not climb without clicks");
}
if (!(ticksB[2].reqTotal > ticksB[0].reqTotal)) {
  throw new Error("tab-b reqTotal did not climb without clicks");
}
const baselineErr = (ticksA[2].errorRate + ticksB[2].errorRate) / 2;
const baselineDeg = (ticksA[2].degradedPct + ticksB[2].degradedPct) / 2;

const patch = await fetch(`${API}/api/rooms/${code}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ affected: ["api"], blastRoot: "api" }),
});
if (!patch.ok) throw new Error(`patch ${patch.status}`);

// let EWMA climb
await Bun.sleep(3500);
const [afterA, afterB] = await Promise.all([waitMetrics(a, 2), waitMetrics(b, 2)]);
const spikeA = afterA[afterA.length - 1];
const spikeB = afterB[afterB.length - 1];

if (!(spikeA.errorRate > baselineErr * 1.8)) {
  throw new Error(`tab-a errorRate did not spike (${spikeA.errorRate} vs baseline ${baselineErr})`);
}
if (!(spikeB.errorRate > baselineErr * 1.8)) {
  throw new Error(`tab-b errorRate did not spike (${spikeB.errorRate} vs baseline ${baselineErr})`);
}
if (!(spikeA.degradedPct > baselineDeg + 5 && spikeB.degradedPct > baselineDeg + 5)) {
  throw new Error(`degradedPct did not rise (a=${spikeA.degradedPct} b=${spikeB.degradedPct} base=${baselineDeg})`);
}
// both tabs roughly same live stream
if (Math.abs(spikeA.degradedPct - spikeB.degradedPct) > 8) {
  throw new Error(`tabs diverged too far a=${spikeA.degradedPct} b=${spikeB.degradedPct}`);
}

a.close();
b.close();
console.log(
  JSON.stringify({
    ok: true,
    room: code,
    baseline: { errorRate: baselineErr, degradedPct: baselineDeg },
    spike: { a: spikeA, b: spikeB },
  }),
);
