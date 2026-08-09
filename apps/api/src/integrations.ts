import { sql } from "./db";
import { buildDiscordPayload, publicRoomUrl, type NotifyRoom } from "./discord";

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
};

function maskUrl(url: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 12 ? u.pathname.slice(0, 8) + "…" : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return "••••";
  }
}

export async function listIntegrations() {
  const rows = await sql<IntegrationRow[]>`SELECT * FROM integrations ORDER BY kind`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    events: r.events ?? [],
    urlMasked: maskUrl(String(r.config?.url || "")),
    hasUrl: Boolean(r.config?.url),
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
    const url = input.url !== undefined ? input.url.trim() : String(existing.config?.url || "");
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
      ${input.events || ["incident.created", "service.degraded", "incident.resolved"]},
      ${input.enabled ?? true}
    )
    RETURNING *
  `;
  return row;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("integration post failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

export async function dispatchIntegrations(
  event: IntegrationEvent,
  roomCode: string,
  room: NotifyRoom,
) {
  const rows = await sql<IntegrationRow[]>`
    SELECT * FROM integrations WHERE enabled = true
  `;
  const link = publicRoomUrl(roomCode);
  let sent = 0;

  for (const row of rows) {
    if (!(row.events || []).includes(event)) continue;
    const url = String(row.config?.url || "").trim();
    if (!url) continue;

    if (row.kind === "discord") {
      const kind = event === "incident.resolved" ? "clear" : "down";
      const ok = await postJson(url, buildDiscordPayload(kind, roomCode, room));
      if (ok) {
        sent++;
        console.log("discord webhook ok", event, roomCode);
      }
    } else {
      const ok = await postJson(url, {
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
      if (ok) {
        sent++;
        console.log("generic webhook ok", event, roomCode);
      }
    }
  }
  return sent;
}

/** Bridge old affected-transition behavior onto integration events. */
export async function notifyAffectedTransition(
  roomCode: string,
  prevAffected: string[],
  room: NotifyRoom,
) {
  const next = room.affected ?? [];
  if (prevAffected.length === 0 && next.length > 0) {
    await dispatchIntegrations("service.degraded", roomCode, room);
  } else if (prevAffected.length > 0 && next.length === 0) {
    await dispatchIntegrations("incident.resolved", roomCode, room);
  }
}
