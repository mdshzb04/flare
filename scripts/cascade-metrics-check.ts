/**
 * Cascade + resolve alongside live metrics.
 * API/WS via env (local docker or Zerops).
 */
const API = process.env.API || "http://127.0.0.1:3000";
const WS = process.env.WS || "ws://127.0.0.1:3000/ws";

type Metrics = {
  type: string;
  errorRate: number;
  degradedPct: number;
  reqTotal: number;
  ts: number;
};

function openWs(room: string, name: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?room=${room}&name=${encodeURIComponent(name)}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`ws failed ${name}`));
  });
}

function nextMetrics(ws: WebSocket, timeoutMs = 10000): Promise<Metrics> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("metrics timeout")), timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      let msg: Metrics;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type !== "metrics") return;
      clearTimeout(t);
      ws.removeEventListener("message", onMsg);
      resolve(msg);
    };
    ws.addEventListener("message", onMsg);
  });
}

async function patch(code: string, body: unknown) {
  const res = await fetch(`${API}/api/rooms/${code}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patch ${res.status}`);
  return res.json();
}

const create = await fetch(`${API}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "cascade+metrics check" }),
});
if (!create.ok) throw new Error(`create ${create.status}`);
const { code } = (await create.json()) as { code: string };

const ws = await openWs(code, "checker");
const m0 = await nextMetrics(ws);
await Bun.sleep(1100);
const m1 = await nextMetrics(ws);
if (!(m1.reqTotal > m0.reqTotal)) throw new Error("metrics not ticking before cascade");

// simulate cascade hops (same as UI: grow affected)
const hops = ["api", "db", "redis", "storage"];
let built: string[] = [];
for (const hop of hops) {
  built = [...built, hop];
  await patch(code, { affected: built, blastRoot: "api", status: "identified" });
  await Bun.sleep(500);
}
await Bun.sleep(3000);
const spiked = await nextMetrics(ws);
if (!(spiked.errorRate > m1.errorRate * 1.8)) {
  throw new Error(`errorRate did not climb with cascade (${spiked.errorRate} vs ${m1.errorRate})`);
}
if (!(spiked.degradedPct > m1.degradedPct + 8)) {
  throw new Error(`degradedPct did not climb (${spiked.degradedPct} vs ${m1.degradedPct})`);
}

// reverse resolve
for (let i = hops.length - 1; i >= 0; i--) {
  const left = hops.slice(0, i);
  await patch(code, {
    affected: left,
    blastRoot: left.length ? "api" : null,
    status: left.length ? "monitoring" : "resolved",
  });
  await Bun.sleep(500);
}
await Bun.sleep(4000);
const calmed = await nextMetrics(ws);
if (!(calmed.errorRate < spiked.errorRate * 0.5)) {
  throw new Error(`errorRate did not fall after resolve (${calmed.errorRate} vs spike ${spiked.errorRate})`);
}
if (!(calmed.degradedPct < spiked.degradedPct - 5)) {
  throw new Error(`degradedPct did not fall (${calmed.degradedPct} vs spike ${spiked.degradedPct})`);
}

const room = await (await fetch(`${API}/api/rooms/${code}`)).json() as {
  affected: string[];
  status: string;
  blastRoot: string | null;
};
if (room.affected?.length) throw new Error(`affected not cleared: ${JSON.stringify(room.affected)}`);
if (room.status !== "resolved") throw new Error(`status=${room.status}`);
if (room.blastRoot) throw new Error(`blastRoot still set: ${room.blastRoot}`);

ws.close();
console.log(
  JSON.stringify({
    ok: true,
    target: API,
    room: code,
    baseline: { errorRate: m1.errorRate, degradedPct: m1.degradedPct },
    afterCascade: { errorRate: spiked.errorRate, degradedPct: spiked.degradedPct },
    afterResolve: { errorRate: calmed.errorRate, degradedPct: calmed.degradedPct, status: room.status },
  }),
);
