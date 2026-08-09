/**
 * External URL probe — isolated from cascade / metrics / Discord / WS.
 * SSRF-hardened: http(s) only, no private/link-local/loopback targets.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Context } from "hono";

const TIMEOUT_MS = 9000;

export type UrlCheckResult = {
  url: string;
  statusCode: number | null;
  latencyMs: number;
  isUp: boolean;
  checkedAt: string;
  reason?: string;
};

/** Fail-closed private / local address detection. */
export function isBlockedIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;

  if (v.includes(":")) {
    if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
    if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:")) return isBlockedIp(v.slice(7));
    return false;
  }

  const parts = v.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function blockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return true;
  return false;
}

/** Parse + validate user URL. Throws Error with public message. */
export async function assertSafeExternalUrl(raw: string): Promise<URL> {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("url_required");

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error("invalid_url");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("http_https_only");
  }
  if (u.username || u.password) throw new Error("credentials_not_allowed");
  if (blockedHostname(u.hostname)) throw new Error("private_target");

  const literal = isIP(u.hostname);
  if (literal) {
    if (isBlockedIp(u.hostname)) throw new Error("private_target");
    return u;
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(u.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("dns_failed");
  }
  if (!addrs.length) throw new Error("dns_failed");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error("private_target");
  }
  return u;
}

async function probe(url: string, method: "HEAD" | "GET", signal: AbortSignal) {
  return fetch(url, {
    method,
    redirect: "follow",
    signal,
    headers: {
      "user-agent": "Flare-URL-Check/1.0",
      accept: "*/*",
    },
  });
}

export async function checkExternalUrl(rawUrl: string): Promise<UrlCheckResult> {
  const checkedAt = new Date().toISOString();
  const target = await assertSafeExternalUrl(rawUrl);
  const href = target.href;

  const started = performance.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    let res = await probe(href, "HEAD", signal);
    // Many hosts reject HEAD — fall back to GET and measure that hop.
    if (res.status === 405 || res.status === 501) {
      res = await probe(href, "GET", signal);
    } else if (res.status >= 400 && methodLikelyUnsupported(res)) {
      res = await probe(href, "GET", signal);
    } else {
      // Drain / cancel body if any (HEAD usually empty)
      void res.body?.cancel?.();
    }

    const latencyMs = Math.round(performance.now() - started);
    const statusCode = res.status;
    const isUp = statusCode > 0 && statusCode < 500;
    return {
      url: href,
      statusCode,
      latencyMs,
      isUp,
      checkedAt,
      reason: isUp ? undefined : `http_${statusCode}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut =
      name === "TimeoutError" ||
      name === "AbortError" ||
      /timeout|aborted/i.test(msg);
    return {
      url: href,
      statusCode: null,
      latencyMs,
      isUp: false,
      checkedAt,
      reason: timedOut ? "timed_out" : "unreachable",
    };
  }
}

function methodLikelyUnsupported(res: Response): boolean {
  // Some CDNs return 403/404 for HEAD specifically; only retry when Allow lacks HEAD.
  const allow = res.headers.get("allow");
  if (allow && !/\bHEAD\b/i.test(allow) && /\bGET\b/i.test(allow)) return true;
  return false;
}

export async function checkUrlRoute(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string };
  try {
    const result = await checkExternalUrl(body.url || "");
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad_request";
    const status =
      msg === "url_required" || msg === "invalid_url" || msg === "http_https_only" || msg === "credentials_not_allowed"
        ? 400
        : msg === "private_target" || msg === "dns_failed"
          ? 400
          : 400;
    return c.json({ error: msg }, status);
  }
}
