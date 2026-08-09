import { sql } from "./db";

export type IncidentEventRow = {
  id: string;
  room_id: string;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

export async function appendIncidentEvent(
  roomId: string,
  kind: string,
  summary: string,
  payload: Record<string, unknown> = {},
): Promise<IncidentEventRow> {
  const id = crypto.randomUUID();
  const [row] = await sql<IncidentEventRow[]>`
    INSERT INTO incident_events (id, room_id, kind, summary, payload)
    VALUES (${id}, ${roomId}, ${kind}, ${summary.slice(0, 500)}, ${sql.json(payload)})
    RETURNING *
  `;
  return row;
}

export async function listIncidentEvents(roomId: string, limit = 200): Promise<IncidentEventRow[]> {
  return sql<IncidentEventRow[]>`
    SELECT * FROM incident_events
    WHERE room_id = ${roomId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

export function serializeIncidentEvent(e: IncidentEventRow) {
  return {
    id: e.id,
    kind: e.kind,
    summary: e.summary,
    payload: e.payload ?? {},
    createdAt: e.created_at,
  };
}
