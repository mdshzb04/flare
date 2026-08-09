/** Parse URL-check probe notes stored in room events. */

export type ParsedUrlCheck = {
  url: string;
  statusCode: string;
  latencyMs: string;
  isUp: boolean;
  reason?: string;
  checkedAt?: string;
};

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

export function displaySiteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || url;
  }
}

export function inferUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.includes("/api") || path.includes("/graphql") || path.includes("/v1/")) {
      return "API endpoint";
    }
    if (path.includes("/health") || path.includes("/status")) return "Health check";
    if (path.endsWith(".json")) return "API endpoint";
    return "Website";
  } catch {
    return "Endpoint";
  }
}

export function urlCheckStatus(isUp: boolean | undefined): "up" | "down" | "unknown" {
  if (isUp === true) return "up";
  if (isUp === false) return "down";
  return "unknown";
}

if (import.meta.main) {
  const sample = [
    "External URL check",
    "URL: https://example.com/api/health",
    "Status: 200",
    "Latency: 42ms",
    "Up: yes",
    "Checked: 2026-08-09T12:00:00.000Z",
  ].join("\n");
  const p = parseUrlCheckNote(sample);
  console.assert(p?.url === "https://example.com/api/health" && p.isUp, "parse");
  console.assert(inferUrlLabel(p!.url) === "API endpoint", "label");
  console.assert(urlCheckStatus(false) === "down", "status");
}
