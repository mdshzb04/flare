import type { EventItem } from "../api";

export type ParsedUrlCheck = {
  url: string;
  statusCode: string;
  latencyMs: string;
  isUp: boolean;
  reason?: string;
  checkedAt?: string;
};

const DEMO_SEED_AUTHORS = new Set(["oncall", "platform", "sre"]);

/** Hide legacy demo seeds that leaked into url_check rooms before the API fix. */
export function urlCheckEvents(events: EventItem[]): EventItem[] {
  return events.filter(
    (ev) => !(ev.kind === "note" && DEMO_SEED_AUTHORS.has(ev.author) && !ev.body.includes("External URL check")),
  );
}

export function parseUrlCheckNote(body: string): ParsedUrlCheck | null {
  if (!body.includes("External URL check")) return null;
  const line = (prefix: string) => {
    const hit = body.split("\n").find((l) => l.startsWith(prefix));
    return hit ? hit.slice(prefix.length).trim() : "";
  };
  const url = line("URL: ");
  if (!url) return null;
  const upRaw = line("Up: ");
  return {
    url,
    statusCode: line("Status: ") || "—",
    latencyMs: line("Latency: ").replace(/ms$/, "") || "—",
    isUp: upRaw === "yes",
    reason: line("Reason: ") || undefined,
    checkedAt: line("Checked: ") || undefined,
  };
}

export function findUrlCheck(events: EventItem[]): ParsedUrlCheck | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const parsed = parseUrlCheckNote(events[i].body);
    if (parsed) return parsed;
  }
  return null;
}

export function listUrlCheckHistory(events: EventItem[]): ParsedUrlCheck[] {
  const out: ParsedUrlCheck[] = [];
  for (const ev of events) {
    const parsed = parseUrlCheckNote(ev.body);
    if (parsed) out.push(parsed);
  }
  return out.reverse();
}

export function displaySiteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || url;
  }
}

if (import.meta.main) {
  const sample = [
    "External URL check",
    "URL: https://example.com",
    "Status: 200",
    "Latency: 42ms",
    "Up: yes",
    "Checked: 2026-08-09T12:00:00.000Z",
  ].join("\n");
  const p = parseUrlCheckNote(sample);
  console.assert(p?.url === "https://example.com" && p.isUp && p.latencyMs === "42", "urlCheckNote parse");
}
