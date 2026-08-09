/**
 * Demo-critical path against API (local or Zerops).
 * API=https://... bun run scripts/demo-path-check.ts
 */
const API = process.env.API || "http://127.0.0.1:3000";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${path} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const created = await j<{ code: string }>("/api/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "demo-path-check", detectionSource: "demo" }),
});
const code = created.code;

await j(`/api/rooms/${code}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ affected: ["api"], blastRoot: "api", status: "identified" }),
});
await Bun.sleep(500);
await j(`/api/rooms/${code}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ affected: ["api", "db", "redis"], blastRoot: "api" }),
});

const detail = await j<{
  timeline: { id: string }[];
  investigation: { insufficient: boolean; evidence: unknown[] };
}>(`/api/incidents/${code}`);
if (detail.timeline.length < 2) throw new Error(`timeline too short: ${detail.timeline.length}`);

const ask = await j<{ answer: string }>(`/api/incidents/${code}/ask`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "Which services are affected?" }),
});
if (!/api/i.test(ask.answer)) throw new Error(`ask failed: ${ask.answer}`);

await j(`/api/rooms/${code}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ affected: [], blastRoot: null, status: "resolved" }),
});

const dash = await j<{ services: unknown[] }>("/api/dashboard");
if (!dash.services?.length) throw new Error("dashboard services empty");

console.log(
  JSON.stringify({
    ok: true,
    room: code,
    timelineEvents: detail.timeline.length,
    evidence: detail.investigation.evidence.length,
    ask: ask.answer,
  }),
);
