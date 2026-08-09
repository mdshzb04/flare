import type { Hono } from "hono";
import { sql } from "./db";
import { matchRule, type MetricsSnapshot, type RuleTrigger } from "./automation";
import { dispatchIntegrations, listIntegrations, upsertIntegration } from "./integrations";
import { askIncident, investigate } from "./investigator";
import {
  appendIncidentEvent,
  listIncidentEvents,
  serializeIncidentEvent,
} from "./timeline";

type Severity = "sev1" | "sev2" | "sev3" | "sev4";
type Status = "investigating" | "identified" | "monitoring" | "mitigating" | "resolved";

type RoomRow = {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  status: Status;
  assignee: string;
  affected: string[] | null;
  blast_root: string | null;
  detection_source?: string;
  resolved_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

type Publish = (roomCode: string, payload: unknown) => Promise<void>;

const SEV_LABEL: Record<string, string> = {
  sev1: "CRITICAL",
  sev2: "HIGH",
  sev3: "MEDIUM",
  sev4: "LOW",
};

async function latestMetrics(): Promise<(MetricsSnapshot & { rps: number; source: string; ts: number }) | null> {
  const raw = await (await import("./redis")).redis.get("flare:metrics:latest");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function registerProductRoutes(
  app: Hono,
  deps: {
    publish: Publish;
    loadRoom: (code: string) => Promise<{ room: RoomRow; events: unknown[] } | null>;
    serializeRoom: (room: RoomRow, events: unknown[]) => Record<string, unknown>;
    id: () => string;
    code: () => string;
  },
) {
  const { publish, loadRoom, serializeRoom, id, code } = deps;

  app.get("/api/dashboard", async (c) => {
    const metrics = await latestMetrics();
    const active = await sql<RoomRow[]>`
      SELECT * FROM rooms WHERE status != 'resolved' ORDER BY updated_at DESC LIMIT 20
    `;
    const recent = await sql<RoomRow[]>`
      SELECT * FROM rooms ORDER BY updated_at DESC LIMIT 10
    `;
    const services = await sql<{ id: string; role: string }[]>`SELECT id, role FROM services ORDER BY id`;
    const affectedSet = new Set(active.flatMap((r) => r.affected ?? []));
    const serviceHealth = services.map((s) => ({
      id: s.id,
      role: s.role,
      status: affectedSet.has(s.id) ? "down" : metrics ? "healthy" : "unknown",
    }));
    const recentTimeline = await sql<
      { id: string; kind: string; summary: string; created_at: Date; code: string }[]
    >`
      SELECT ie.id, ie.kind, ie.summary, ie.created_at, r.code
      FROM incident_events ie
      JOIN rooms r ON r.id = ie.room_id
      ORDER BY ie.created_at DESC
      LIMIT 15
    `;
    return c.json({
      mode: "DEMO",
      metrics: metrics
        ? { ...metrics, label: "DEMO", connected: true }
        : { label: "UNKNOWN", connected: false },
      activeIncidents: active.map((r) => ({
        code: r.code,
        title: r.title,
        severity: r.severity,
        severityLabel: SEV_LABEL[r.severity] || r.severity,
        status: r.status,
        affected: r.affected ?? [],
        updatedAt: r.updated_at,
      })),
      recentIncidents: recent.map((r) => ({
        code: r.code,
        title: r.title,
        severity: r.severity,
        status: r.status,
        updatedAt: r.updated_at,
      })),
      services: serviceHealth,
      recentTimeline: recentTimeline.map((t) => ({
        id: t.id,
        kind: t.kind,
        summary: t.summary,
        roomCode: t.code,
        createdAt: t.created_at,
      })),
      warRooms: active.map((r) => ({ code: r.code, title: r.title })),
    });
  });

  app.get("/api/services", async (c) => {
    const metrics = await latestMetrics();
    const rows = await sql<{ id: string; role: string; deps: string[] }[]>`
      SELECT id, role, deps FROM services ORDER BY id
    `;
    const open = await sql<RoomRow[]>`
      SELECT * FROM rooms WHERE status != 'resolved' AND cardinality(affected) > 0
    `;
    const affected = new Set(open.flatMap((r) => r.affected ?? []));
    return c.json({
      services: rows.map((s) => {
        const hit = affected.has(s.id);
        return {
          id: s.id,
          name: s.id,
          role: s.role,
          deps: s.deps ?? [],
          status: hit ? "down" : metrics ? "healthy" : "unknown",
          errorRate: metrics?.errorRate ?? null,
          latencyMs: metrics?.latencyMs ?? null,
          queueDepth: s.id === "worker" || s.id === "redis" ? metrics?.queueDepth ?? null : null,
          rps: metrics?.rps ?? null,
          metricsSource: metrics ? "demo" : null,
          lastIncident: open.find((r) => (r.affected ?? []).includes(s.id))?.code ?? null,
        };
      }),
    });
  });

  app.get("/api/services/:id", async (c) => {
    const sid = c.req.param("id");
    const [svc] = await sql<{ id: string; role: string; deps: string[] }[]>`
      SELECT * FROM services WHERE id = ${sid} LIMIT 1
    `;
    if (!svc) return c.json({ error: "not_found" }, 404);
    const metrics = await latestMetrics();
    const telemetry = await sql<
      { id: string; type: string; severity: string; message: string; created_at: Date }[]
    >`
      SELECT id, type, severity, message, created_at FROM telemetry_events
      WHERE service = ${sid} ORDER BY created_at DESC LIMIT 30
    `;
    const incidents = await sql<RoomRow[]>`
      SELECT * FROM rooms WHERE ${sid} = ANY(affected) ORDER BY updated_at DESC LIMIT 10
    `;
    return c.json({
      id: svc.id,
      role: svc.role,
      deps: svc.deps ?? [],
      metrics,
      telemetry: telemetry.map((t) => ({
        id: t.id,
        type: t.type,
        severity: t.severity,
        message: t.message,
        createdAt: t.created_at,
      })),
      incidents: incidents.map((r) => ({
        code: r.code,
        title: r.title,
        status: r.status,
        severity: r.severity,
      })),
    });
  });

  app.get("/api/incidents", async (c) => {
    const rows = await sql<RoomRow[]>`SELECT * FROM rooms ORDER BY updated_at DESC LIMIT 50`;
    return c.json({
      incidents: rows.map((r) => ({
        code: r.code,
        title: r.title,
        severity: r.severity,
        severityLabel: SEV_LABEL[r.severity] || r.severity,
        status: r.status,
        affected: r.affected ?? [],
        blastRoot: r.blast_root || null,
        detectionSource: r.detection_source || "manual",
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        resolvedAt: r.resolved_at ?? null,
      })),
    });
  });

  app.get("/api/incidents/:code", async (c) => {
    const data = await loadRoom(c.req.param("code"));
    if (!data) return c.json({ error: "not_found" }, 404);
    const timeline = await listIncidentEvents(data.room.id);
    const metrics = await latestMetrics();
    const report = investigate({
      title: data.room.title,
      severity: data.room.severity,
      status: data.room.status,
      affected: data.room.affected ?? [],
      blastRoot: data.room.blast_root || null,
      events: timeline.map((e) => ({
        id: e.id,
        kind: e.kind,
        summary: e.summary,
        payload: e.payload as Record<string, unknown>,
        createdAt: e.created_at,
      })),
      latestMetrics: metrics,
    });
    return c.json({
      incident: {
        ...serializeRoom(data.room, data.events),
        detectionSource: data.room.detection_source || "manual",
        resolvedAt: data.room.resolved_at ?? null,
        severityLabel: SEV_LABEL[data.room.severity] || data.room.severity,
      },
      timeline: timeline.map(serializeIncidentEvent),
      investigation: report,
      metrics,
    });
  });

  app.get("/api/incidents/:code/investigate", async (c) => {
    const data = await loadRoom(c.req.param("code"));
    if (!data) return c.json({ error: "not_found" }, 404);
    const timeline = await listIncidentEvents(data.room.id);
    const metrics = await latestMetrics();
    return c.json(
      investigate({
        title: data.room.title,
        severity: data.room.severity,
        status: data.room.status,
        affected: data.room.affected ?? [],
        blastRoot: data.room.blast_root || null,
        events: timeline.map((e) => ({
          id: e.id,
          kind: e.kind,
          summary: e.summary,
          createdAt: e.created_at,
        })),
        latestMetrics: metrics,
      }),
    );
  });

  app.post("/api/incidents/:code/ask", async (c) => {
    const data = await loadRoom(c.req.param("code"));
    if (!data) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json()) as { question?: string };
    const question = (body.question || "").slice(0, 500);
    if (!question) return c.json({ error: "question_required" }, 400);
    const timeline = await listIncidentEvents(data.room.id);
    const metrics = await latestMetrics();
    const input = {
      title: data.room.title,
      severity: data.room.severity,
      status: data.room.status,
      affected: data.room.affected ?? [],
      blastRoot: data.room.blast_root || null,
      events: timeline.map((e) => ({
        id: e.id,
        kind: e.kind,
        summary: e.summary,
        createdAt: e.created_at,
      })),
      latestMetrics: metrics,
    };
    const report = investigate(input);
    return c.json(askIncident(question, input, report));
  });

  app.post("/api/incidents/:code/actions", async (c) => {
    const roomCode = c.req.param("code");
    const data = await loadRoom(roomCode);
    if (!data) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json()) as { action?: string; note?: string; author?: string };
    const action = body.action || "";
    const author = (body.author || "operator").slice(0, 64);
    let room = data.room;

    if (action === "acknowledge" || action === "investigate") {
      const [r] = await sql<RoomRow[]>`
        UPDATE rooms SET status = ${"investigating"}, updated_at = NOW() WHERE id = ${room.id} RETURNING *
      `;
      room = r;
      const ev = await appendIncidentEvent(room.id, "status.investigating", `${author} started investigation`);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await publish(roomCode, { type: "activity", text: `${author} started investigation` });
    } else if (action === "mitigate") {
      const [r] = await sql<RoomRow[]>`
        UPDATE rooms SET status = ${"mitigating"}, updated_at = NOW() WHERE id = ${room.id} RETURNING *
      `;
      room = r;
      const ev = await appendIncidentEvent(room.id, "status.mitigating", `${author} began mitigation`);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    } else if (action === "resolve") {
      const [r] = await sql<RoomRow[]>`
        UPDATE rooms SET status = ${"resolved"}, affected = ${[]}, blast_root = ${""},
          resolved_at = NOW(), updated_at = NOW() WHERE id = ${room.id} RETURNING *
      `;
      room = r;
      const ev = await appendIncidentEvent(room.id, "incident.resolved", `${author} resolved the incident`);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await dispatchIntegrations("incident.resolved", roomCode, {
        title: room.title,
        severity: room.severity,
        status: room.status,
        affected: [],
        blastRoot: null,
      });
    } else if (action === "note") {
      const text = (body.note || "").slice(0, 2000);
      if (!text) return c.json({ error: "note_required" }, 400);
      const ev = await appendIncidentEvent(room.id, "note", `${author}: ${text}`, { author });
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    } else if (action === "alert") {
      const sent = await dispatchIntegrations("incident.escalated", roomCode, {
        title: room.title,
        severity: room.severity,
        status: room.status,
        affected: room.affected ?? [],
        blastRoot: room.blast_root,
      });
      const ev = await appendIncidentEvent(room.id, "alert.sent", `Alert dispatched (${sent} channel(s))`);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await publish(roomCode, { type: "activity", text: "Alert sent" });
    } else {
      return c.json({ error: "unknown_action" }, 400);
    }

    const events = data.events;
    const serialized = serializeRoom(room, events);
    await publish(roomCode, { type: "room:update", room: serialized });
    return c.json({ ok: true, room: serialized });
  });

  app.post("/api/telemetry/events", async (c) => {
    const body = (await c.req.json()) as {
      service?: string;
      type?: string;
      severity?: string;
      message?: string;
      timestamp?: string;
      metadata?: Record<string, unknown>;
    };
    const service = String(body.service || "").slice(0, 64);
    const type = String(body.type || "custom").slice(0, 32);
    const severity = String(body.severity || "medium").slice(0, 16);
    const message = String(body.message || "").slice(0, 2000);
    if (!service || !message) return c.json({ error: "service_and_message_required" }, 400);
    const allowedType = new Set(["error", "latency", "deployment", "health", "queue", "custom"]);
    if (!allowedType.has(type)) return c.json({ error: "invalid_type" }, 400);

    const tid = id();
    await sql`
      INSERT INTO telemetry_events (id, service, type, severity, message, metadata)
      VALUES (${tid}, ${service}, ${type}, ${severity}, ${message}, ${sql.json(body.metadata || {})})
    `;

    // Attach to most recent open incident that includes this service, or create one for high severity
    let roomCode: string | null = null;
    const [open] = await sql<RoomRow[]>`
      SELECT * FROM rooms
      WHERE status != 'resolved' AND (${service} = ANY(affected) OR cardinality(affected) = 0)
      ORDER BY updated_at DESC LIMIT 1
    `;
    if (open) {
      roomCode = open.code;
      const ev = await appendIncidentEvent(
        open.id,
        `telemetry.${type}`,
        `${service}: ${message}`,
        { service, severity, telemetryId: tid },
      );
      await publish(open.code, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    } else if (severity === "high" || severity === "critical") {
      const roomId = id();
      roomCode = code();
      await sql`
        INSERT INTO rooms (id, code, title, severity, status, affected, blast_root, detection_source)
        VALUES (
          ${roomId}, ${roomCode}, ${`${service} ${type}`},
          ${severity === "critical" ? "sev1" : "sev2"},
          ${"investigating"}, ${[service]}, ${service}, ${"telemetry"}
        )
      `;
      await appendIncidentEvent(roomId, "incident.created", `Incident created from telemetry (${service})`);
      await appendIncidentEvent(roomId, `telemetry.${type}`, `${service}: ${message}`, {
        service,
        severity,
        telemetryId: tid,
      });
      await dispatchIntegrations("incident.created", roomCode, {
        title: `${service} ${type}`,
        severity: severity === "critical" ? "sev1" : "sev2",
        status: "investigating",
        affected: [service],
        blastRoot: service,
      });
    }

    return c.json({ ok: true, id: tid, roomCode }, 201);
  });

  app.get("/api/integrations", async (c) => c.json({ integrations: await listIntegrations() }));

  app.put("/api/integrations", async (c) => {
    const body = (await c.req.json()) as {
      id?: string;
      kind?: string;
      name?: string;
      url?: string;
      events?: string[];
      enabled?: boolean;
    };
    if (!body.kind) return c.json({ error: "kind_required" }, 400);
    await upsertIntegration({
      id: body.id,
      kind: body.kind,
      name: body.name,
      url: body.url,
      events: body.events,
      enabled: body.enabled,
    });
    return c.json({ integrations: await listIntegrations() });
  });

  app.get("/api/automation/rules", async (c) => {
    const rows = await sql<
      { id: string; name: string; enabled: boolean; trigger: RuleTrigger; actions: string[]; created_at: Date }[]
    >`SELECT * FROM automation_rules ORDER BY created_at ASC`;
    return c.json({
      rules: rows.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        trigger: r.trigger,
        actions: r.actions,
        createdAt: r.created_at,
      })),
    });
  });

  app.post("/api/automation/rules", async (c) => {
    const body = (await c.req.json()) as {
      name?: string;
      enabled?: boolean;
      trigger?: RuleTrigger;
      actions?: string[];
    };
    const name = (body.name || "Rule").slice(0, 120);
    const trigger = body.trigger || { metric: "errorRate", op: "gt", value: 10 };
    const actions = body.actions || ["create_incident"];
    const rid = id();
    await sql`
      INSERT INTO automation_rules (id, name, enabled, trigger, actions)
      VALUES (${rid}, ${name}, ${body.enabled ?? true}, ${sql.json(trigger)}, ${sql.json(actions)})
    `;
    return c.json({ id: rid }, 201);
  });

  app.patch("/api/automation/rules/:id", async (c) => {
    const rid = c.req.param("id");
    const body = (await c.req.json()) as {
      name?: string;
      enabled?: boolean;
      trigger?: RuleTrigger;
      actions?: string[];
    };
    const [row] = await sql<
      { id: string; name: string; enabled: boolean; trigger: RuleTrigger; actions: string[] }[]
    >`SELECT * FROM automation_rules WHERE id = ${rid}`;
    if (!row) return c.json({ error: "not_found" }, 404);
    await sql`
      UPDATE automation_rules SET
        name = ${body.name ?? row.name},
        enabled = ${body.enabled ?? row.enabled},
        trigger = ${sql.json(body.trigger ?? row.trigger)},
        actions = ${sql.json(body.actions ?? row.actions)}
      WHERE id = ${rid}
    `;
    return c.json({ ok: true });
  });

  // Internal: worker appends threshold / automation events
  app.post("/api/internal/timeline", async (c) => {
    const secret = process.env.INTERNAL_SECRET || "flare-dev";
    if (c.req.header("x-flare-secret") !== secret) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json()) as {
      roomCode?: string;
      kind?: string;
      summary?: string;
      payload?: Record<string, unknown>;
    };
    const data = await loadRoom(body.roomCode || "");
    if (!data) return c.json({ error: "not_found" }, 404);
    const ev = await appendIncidentEvent(
      data.room.id,
      body.kind || "metric.threshold",
      body.summary || "threshold",
      body.payload || {},
    );
    await publish(data.room.code, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    return c.json({ ok: true, event: serializeIncidentEvent(ev) });
  });

  app.post("/api/internal/automation-fire", async (c) => {
    const secret = process.env.INTERNAL_SECRET || "flare-dev";
    if (c.req.header("x-flare-secret") !== secret) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json()) as {
      ruleName?: string;
      metrics?: MetricsSnapshot;
      actions?: string[];
    };
    const metrics = body.metrics;
    if (!metrics) return c.json({ error: "metrics_required" }, 400);

    let roomCode: string | null = null;
    const [open] = await sql<RoomRow[]>`
      SELECT * FROM rooms WHERE status != 'resolved' ORDER BY updated_at DESC LIMIT 1
    `;
    if (open) {
      roomCode = open.code;
    } else if ((body.actions || []).includes("create_incident")) {
      const roomId = id();
      roomCode = code();
      await sql`
        INSERT INTO rooms (id, code, title, severity, status, detection_source)
        VALUES (${roomId}, ${roomCode}, ${`Automation: ${body.ruleName || "rule"}`}, ${"sev2"}, ${"investigating"}, ${"automation"})
      `;
      await appendIncidentEvent(roomId, "incident.created", `Created by automation (${body.ruleName})`);
      await dispatchIntegrations("incident.created", roomCode, {
        title: `Automation: ${body.ruleName || "rule"}`,
        severity: "sev2",
        status: "investigating",
        affected: [],
      });
    }

    if (roomCode && (body.actions || []).includes("discord_alert")) {
      const data = await loadRoom(roomCode);
      if (data) {
        await dispatchIntegrations("incident.escalated", roomCode, {
          title: data.room.title,
          severity: data.room.severity,
          status: data.room.status,
          affected: data.room.affected ?? [],
          blastRoot: data.room.blast_root,
        });
        await appendIncidentEvent(data.room.id, "alert.sent", `Automation alert: ${body.ruleName}`);
      }
    }

    return c.json({ ok: true, roomCode, matched: true });
  });

  // exported for tests
  void matchRule;
}
