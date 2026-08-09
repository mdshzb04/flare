/**
 * Minimal OTLP HTTP/JSON traces ingestion → Flare telemetry_events.
 * No API key. Accepts real exporter payloads from Acme Shop.
 */
import type { Hono } from "hono";
import { ingestTelemetryEvent } from "./ingestTelemetry";

type Attr = { key?: string; value?: Record<string, unknown> };

function attrMap(attrs: Attr[] | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of attrs || []) {
    if (!a?.key || !a.value) continue;
    const v = a.value;
    if (typeof v.stringValue === "string") out[a.key] = v.stringValue;
    else if (typeof v.intValue === "string" || typeof v.intValue === "number")
      out[a.key] = Number(v.intValue);
    else if (typeof v.doubleValue === "number") out[a.key] = v.doubleValue;
    else if (typeof v.boolValue === "boolean") out[a.key] = v.boolValue;
  }
  return out;
}

function nanoToMs(start?: string | number, end?: string | number): number {
  const s = Number(start || 0);
  const e = Number(end || 0);
  if (!s || !e || e < s) return 0;
  return Math.round((e - s) / 1e6);
}

export function registerOtlpRoutes(
  app: Hono,
  deps: {
    id: () => string;
    publish: (roomCode: string, payload: unknown) => Promise<void>;
  },
) {
  app.post("/v1/traces", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      resourceSpans?: {
        resource?: { attributes?: Attr[] };
        scopeSpans?: {
          spans?: {
            traceId?: string;
            spanId?: string;
            name?: string;
            startTimeUnixNano?: string;
            endTimeUnixNano?: string;
            attributes?: Attr[];
            status?: { code?: number; message?: string };
            events?: { name?: string; attributes?: Attr[] }[];
          }[];
        }[];
      }[];
    } | null;

    if (!body?.resourceSpans?.length) {
      return c.json({ partialSuccess: {} }, 200);
    }

    let accepted = 0;
    for (const rs of body.resourceSpans) {
      const resource = attrMap(rs.resource?.attributes);
      const service = String(resource["service.name"] || "unknown").slice(0, 64);
      const version = String(resource["service.version"] || "");
      const env = String(resource["deployment.environment"] || resource["deployment.environment.name"] || "");

      for (const scope of rs.scopeSpans || []) {
        for (const span of scope.spans || []) {
          const attrs = attrMap(span.attributes);
          const statusCode = Number(attrs["http.response.status_code"] || attrs["http.status_code"] || 0);
          const method = String(attrs["http.request.method"] || attrs["http.method"] || "");
          const route = String(attrs["http.route"] || attrs["url.path"] || span.name || "");
          const latencyMs = nanoToMs(span.startTimeUnixNano, span.endTimeUnixNano);
          const otelStatus = Number(span.status?.code || 0); // 2 = ERROR
          const isError = otelStatus === 2 || statusCode >= 500;
          const exception =
            (span.events || [])
              .filter((e) => e.name === "exception")
              .map((e) => attrMap(e.attributes)["exception.message"])
              .find(Boolean) || span.status?.message || "";

          const metadata = {
            source: "otel",
            serviceVersion: version || undefined,
            environment: env || undefined,
            spanName: span.name || "",
            method,
            route,
            status: statusCode || undefined,
            latencyMs,
            traceId: span.traceId || "",
            spanId: span.spanId || "",
            exception: exception ? String(exception).slice(0, 500) : undefined,
          };

          try {
            await ingestTelemetryEvent(
              {
                service,
                type: "request",
                severity: isError ? "high" : "info",
                message: isError
                  ? `OTEL ${method || "HTTP"} ${route} → ${statusCode || "ERROR"}`
                  : `OTEL ${method || "HTTP"} ${route} → ${statusCode || 200}`,
                metadata,
              },
              deps,
            );
            accepted++;

            if (isError) {
              await ingestTelemetryEvent(
                {
                  service,
                  type: "error",
                  severity: "high",
                  message: exception
                    ? `OTEL exception: ${String(exception).slice(0, 400)}`
                    : `OTEL HTTP ${statusCode || "error"} on ${route}`,
                  metadata,
                },
                deps,
              );
              accepted++;
            } else if (latencyMs > 800) {
              await ingestTelemetryEvent(
                {
                  service,
                  type: "latency",
                  severity: "medium",
                  message: `OTEL elevated latency ${latencyMs}ms on ${route}`,
                  metadata,
                },
                deps,
              );
              accepted++;
            }
          } catch (err) {
            console.error("otlp ingest span failed", err);
          }
        }
      }
    }

    // OTLP success response (empty partialSuccess = all accepted)
    return c.json({ partialSuccess: { rejectedSpans: 0 } }, 200);
  });
}
