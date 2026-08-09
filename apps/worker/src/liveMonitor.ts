import type postgres from "postgres";

export type LiveSnap = {
  errorRate: number;
  latencyMs: number;
  queueDepth: number;
  degradedPct: number;
  rps: number;
  requestCount: number;
  errorCount: number;
  availability: number;
  source: "live";
  label: "LIVE";
  ts: number;
  windowSec: number;
};

type Sql = ReturnType<typeof postgres>;

export async function computeLiveMetrics(sql: Sql, windowSec = 120): Promise<LiveSnap> {
  const [row] = await sql<
    {
      requests: string | number;
      errors: string | number;
      latency: string | number | null;
      health_ok: string | number;
      health_total: string | number;
      jobs: string | number;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE type IN ('request', 'error')) AS requests,
      COUNT(*) FILTER (
        WHERE type = 'error'
           OR (type = 'request' AND COALESCE((metadata->>'status')::int, 0) >= 500)
      ) AS errors,
      AVG(NULLIF(metadata->>'latencyMs', '')::double precision)
        FILTER (WHERE metadata ? 'latencyMs') AS latency,
      COUNT(*) FILTER (
        WHERE type = 'health' AND COALESCE((metadata->>'availability')::int, 0) = 1
      ) AS health_ok,
      COUNT(*) FILTER (WHERE type = 'health') AS health_total,
      COUNT(*) FILTER (WHERE type = 'job' AND severity IN ('high', 'critical')) AS jobs
    FROM telemetry_events
    WHERE created_at > NOW() - (${windowSec}::int * INTERVAL '1 second')
  `;

  const requests = Number(row?.requests || 0);
  const errors = Number(row?.errors || 0);
  const latencyMs = Number(row?.latency || 0);
  const healthOk = Number(row?.health_ok || 0);
  const healthTotal = Number(row?.health_total || 0);
  const badJobs = Number(row?.jobs || 0);
  const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
  const availability =
    healthTotal > 0 ? healthOk / healthTotal : requests > 0 ? 1 - errors / requests : 1;
  const rps = requests / windowSec;
  const degradedPct = Math.min(
    100,
    Math.round(errorRate * 0.7 + (1 - availability) * 100 * 0.3 + Math.min(badJobs, 10)),
  );

  return {
    errorRate: Math.round(errorRate * 10) / 10,
    latencyMs: Math.round(latencyMs),
    queueDepth: badJobs,
    degradedPct,
    rps: Math.round(rps * 100) / 100,
    requestCount: requests,
    errorCount: errors,
    availability: Math.round(availability * 1000) / 1000,
    source: "live",
    label: "LIVE",
    ts: Date.now(),
    windowSec,
  };
}

export function isRecovered(snap: LiveSnap): boolean {
  return (
    snap.requestCount >= 3 &&
    snap.errorRate < 8 &&
    snap.availability >= 0.9 &&
    snap.latencyMs < 1500
  );
}

export function isDegraded(snap: LiveSnap): boolean {
  return snap.requestCount >= 4 && (snap.errorRate > 25 || snap.availability < 0.7);
}
