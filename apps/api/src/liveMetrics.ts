import { sql } from "./db";

export type LiveMetrics = {
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

type AggRow = {
  requests: string | number;
  errors: string | number;
  latency: string | number | null;
  health_ok: string | number;
  health_total: string | number;
  jobs: string | number;
};

/** Aggregate real telemetry_events — never fabricates samples. */
export async function computeLiveMetrics(windowSec = 120): Promise<LiveMetrics> {
  const [row] = await sql<AggRow[]>`
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

export type ServiceLiveStats = {
  service: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyMs: number;
  availability: number;
  latestType: string | null;
  latestMessage: string | null;
  latestAt: Date | null;
  healthStatus: "healthy" | "degraded" | "down" | "unknown";
};

export async function computeServiceStats(windowSec = 120): Promise<ServiceLiveStats[]> {
  const rows = await sql<
    {
      service: string;
      requests: string | number;
      errors: string | number;
      latency: string | number | null;
      health_ok: string | number;
      health_total: string | number;
    }[]
  >`
    SELECT
      service,
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
      COUNT(*) FILTER (WHERE type = 'health') AS health_total
    FROM telemetry_events
    WHERE created_at > NOW() - (${windowSec}::int * INTERVAL '1 second')
    GROUP BY service
  `;

  const latest = await sql<
    { service: string; type: string; message: string; created_at: Date }[]
  >`
    SELECT DISTINCT ON (service) service, type, message, created_at
    FROM telemetry_events
    ORDER BY service, created_at DESC
  `;
  const latestMap = new Map(latest.map((l) => [l.service, l]));

  return rows.map((r) => {
    const requests = Number(r.requests || 0);
    const errors = Number(r.errors || 0);
    const healthOk = Number(r.health_ok || 0);
    const healthTotal = Number(r.health_total || 0);
    const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
    const availability =
      healthTotal > 0 ? healthOk / healthTotal : requests > 0 ? 1 - errors / requests : 1;
    let healthStatus: ServiceLiveStats["healthStatus"] = "unknown";
    if (healthTotal > 0 || requests > 0) {
      if (availability < 0.5 || errorRate > 40) healthStatus = "down";
      else if (availability < 0.95 || errorRate > 8) healthStatus = "degraded";
      else healthStatus = "healthy";
    }
    const last = latestMap.get(r.service);
    return {
      service: r.service,
      requestCount: requests,
      errorCount: errors,
      errorRate: Math.round(errorRate * 10) / 10,
      latencyMs: Math.round(Number(r.latency || 0)),
      availability: Math.round(availability * 1000) / 1000,
      latestType: last?.type ?? null,
      latestMessage: last?.message ?? null,
      latestAt: last?.created_at ?? null,
      healthStatus,
    };
  });
}
