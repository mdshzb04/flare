import { sql } from "./db";
import {
  buildDiscordAlert,
  publicRoomUrl,
  type NotifyMetrics,
  type NotifyRoom,
} from "./discord";
import { redis } from "./redis";

async function liveMetricsSnapshot(): Promise<NotifyMetrics | null> {
  try {
    const raw = await redis.get("flare:metrics:live");
    if (!raw) return null;
    const m = JSON.parse(raw) as {
      errorRate?: number;
      availability?: number;
      latencyMs?: number;
    };
    const out: NotifyMetrics = {};
    if (m.errorRate != null) out.errorRate = m.errorRate;
    if (m.availability != null) out.availability = m.availability;
    if (m.latencyMs != null) out.latencyMs = m.latencyMs;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export type IntegrationEvent =
  | "incident.created"
  | "incident.escalated"
  | "service.degraded"
  | "incident.resolved";

type IntegrationRow = {
  id: string;
  kind: string;
  name: string;
  config: { url?: string };
  events: string[];
  enabled: boolean;
  last_delivery_status?: string | null;
  last_delivery_at?: Date | null;
  last_delivery_error?: string | null;
};

const DEFAULT_EVENTS: IntegrationEvent[] = [
  "incident.created",
  "incident.escalated",
  "service.degraded",
  "incident.resolved",
];

export async function listIntegrations() {
  const rows = await sql<IntegrationRow[]>`SELECT * FROM integrations ORDER BY kind`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    events: r.events ?? [],
    configured: Boolean(String(r.config?.url || "").trim()),
    lastDeliveryStatus: r.last_delivery_status || null,
    lastDeliveryAt: r.last_delivery_at || null,
    lastError: r.last_delivery_error || null,
  }));
}

export async function upsertIntegration(input: {
  id?: string;
  kind: string;
  name?: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
}) {
  const kind = input.kind === "webhook" ? "webhook" : "discord";
  const [existing] = input.id
    ? await sql<IntegrationRow[]>`SELECT * FROM integrations WHERE id = ${input.id} LIMIT 1`
    : await sql<IntegrationRow[]>`SELECT * FROM integrations WHERE kind = ${kind} LIMIT 1`;

  if (existing) {
    const prevUrl = String(existing.config?.url || "").trim();
    const url =
      input.url !== undefined && input.url.trim() !== "" ? input.url.trim() : prevUrl;
    const events = input.events ?? existing.events;
    const enabled = input.enabled ?? existing.enabled;
    const name = input.name ?? existing.name;
    const [row] = await sql<IntegrationRow[]>`
      UPDATE integrations
      SET name = ${name}, config = ${sql.json({ url })}, events = ${events}, enabled = ${enabled}
      WHERE id = ${existing.id}
      RETURNING *
    `;
    return row;
  }

  const id = crypto.randomUUID();
  const [row] = await sql<IntegrationRow[]>`
    INSERT INTO integrations (id, kind, name, config, events, enabled)
    VALUES (
      ${id},
      ${kind},
      ${input.name || kind},
      ${sql.json({ url: (input.url || "").trim() })},
      ${input.events || DEFAULT_EVENTS},
      ${input.enabled ?? true}
    )
    RETURNING *
  `;
  return row;
}

async function recordDelivery(
  id: string,
  status: "ok" | "failed",
  error: string | null,
) {
  await sql`
    UPDATE integrations
    SET last_delivery_status = ${status},
        last_delivery_at = NOW(),
        last_delivery_error = ${error}
    WHERE id = ${id}
  `;
}

type PostResult = { ok: boolean; status: number; error: string | null };

async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    // Discord returns 204 No Content on success
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, error: null };
    }
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network_error";
    const sanitized = msg.includes("abort") ? "timeout" : msg.slice(0, 160);
    return { ok: false, status: 0, error: sanitized };
  }
}

async function alreadySent(dedupeKey: string): Promise<boolean> {
  try {
    const ok = await redis.set(`flare:alert:${dedupeKey}`, "1", "EX", 3600, "NX");
    return ok !== "OK";
  } catch {
    return false;
  }
}

export async function dispatchIntegrations(
  event: IntegrationEvent,
  roomCode: string,
  room: NotifyRoom,
  opts?: { force?: boolean },
) {
  const rows = await sql<IntegrationRow[]>`
    SELECT * FROM integrations WHERE enabled = true
  `;
  const link = publicRoomUrl(roomCode);
  let sent = 0;

  for (const row of rows) {
    if (!(row.events || []).includes(event)) continue;
    const url = String(row.config?.url || "").trim();
    if (!url) {
      await recordDelivery(row.id, "failed", "Webhook URL not configured");
      continue;
    }

    const dedupeKey = `${event}:${roomCode}:${row.id}`;
    if (!opts?.force && (await alreadySent(dedupeKey))) {
      console.log("integration dedupe skip", event, roomCode, row.kind);
      continue;
    }

    let result: PostResult;
    if (row.kind === "discord") {
      const metrics = room.metrics ?? (await liveMetricsSnapshot());
      const payload = buildDiscordAlert(event, roomCode, { ...room, metrics });
      result = await postJson(url, payload);
    } else {
      result = await postJson(url, {
        event,
        incident: {
          code: roomCode,
          title: room.title,
          severity: room.severity,
          status: room.status,
          affected: room.affected,
          blastRoot: room.blastRoot ?? null,
        },
        link,
        at: new Date().toISOString(),
      });
    }

    if (result.ok) {
      sent++;
      await recordDelivery(row.id, "ok", null);
      console.log("integration ok", row.kind, event, roomCode, "http", result.status);
    } else {
      await recordDelivery(row.id, "failed", result.error);
      console.error("integration failed", row.kind, event, roomCode, result.error);
    }
  }
  return sent;
}

export async function sendTestAlert(kind = "discord"): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
}> {
  const [row] = await sql<IntegrationRow[]>`
    SELECT * FROM integrations WHERE kind = ${kind} LIMIT 1
  `;
  if (!row) return { ok: false, status: null, error: "Integration not found" };
  const url = String(row.config?.url || "").trim();
  if (!url) {
    await recordDelivery(row.id, "failed", "Webhook URL not configured");
    return { ok: false, status: null, error: "Webhook URL not configured" };
  }

  const body = buildDiscordAlert("test", "test", {
    title: "Discord test",
    severity: "sev4",
    status: "connected",
    affected: [],
  });

  const result = await postJson(url, body);
  if (result.ok) {
    await recordDelivery(row.id, "ok", null);
    console.log("discord test ok", result.status);
  } else {
    await recordDelivery(row.id, "failed", result.error);
    console.error("discord test failed", result.error);
  }
  return { ok: result.ok, status: result.status || null, error: result.error };
}

/** Bridge old affected-transition behavior onto integration events. */
export async function notifyAffectedTransition(
  roomCode: string,
  prevAffected: string[],
  room: NotifyRoom,
): Promise<number> {
  const next = room.affected ?? [];
  if (prevAffected.length === 0 && next.length > 0) {
    return dispatchIntegrations("service.degraded", roomCode, room);
  }
  if (prevAffected.length > 0 && next.length === 0) {
    return dispatchIntegrations("incident.resolved", roomCode, {
      ...room,
      alertVariant: "all_clear",
    });
  }
  return 0;
}
