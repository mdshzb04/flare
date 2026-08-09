import { sql } from "./db";
import { appendIncidentEvent, serializeIncidentEvent } from "./timeline";

type RoomRow = { id: string; code: string };

export type IngestInput = {
  service: string;
  type: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
};

const ALLOWED = new Set([
  "request",
  "error",
  "latency",
  "health",
  "job",
  "deployment",
  "custom",
  "queue",
]);

export async function ingestTelemetryEvent(
  input: IngestInput,
  deps: {
    id: () => string;
    publish: (roomCode: string, payload: unknown) => Promise<void>;
  },
): Promise<{ id: string; roomCode: string | null }> {
  const service = String(input.service || "").slice(0, 64);
  const type = String(input.type || "custom").slice(0, 32);
  const severity = String(input.severity || "medium").slice(0, 16);
  const message = String(input.message || "").slice(0, 2000);
  if (!service || !message) throw new Error("service_and_message_required");
  if (!ALLOWED.has(type)) throw new Error("invalid_type");

  const tid = deps.id();
  const metadata = input.metadata || {};
  await sql`
    INSERT INTO telemetry_events (id, service, type, severity, message, metadata)
    VALUES (${tid}, ${service}, ${type}, ${severity}, ${message}, ${sql.json(metadata)})
  `;

  let roomCode: string | null = null;
  const [open] = await sql<RoomRow[]>`
    SELECT id, code FROM rooms
    WHERE status != 'resolved' AND ${service} = ANY(affected)
    ORDER BY updated_at DESC LIMIT 1
  `;
  if (open) {
    roomCode = open.code;
    const noisy = type === "request" && (severity === "info" || severity === "low");
    if (!noisy) {
      const ev = await appendIncidentEvent(
        open.id,
        `telemetry.${type}`,
        `${service}: ${message}`,
        { service, severity, telemetryId: tid, metadata },
      );
      await deps.publish(open.code, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    }
  }
  return { id: tid, roomCode };
}
