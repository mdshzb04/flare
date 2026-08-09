import type { Hono } from "hono";
import { checkUrlRoute } from "./checkUrl";
import { cleanupTestRooms } from "./cleanupTestRooms";
import { inferUrlLabel, parseUrlCheckNote, urlCheckStatus, displaySiteName } from "./urlCheckNote";
import { sql } from "./db";
import { type MetricsSnapshot, type RuleTrigger } from "./automation";
import {
  dispatchIntegrations,
  listIntegrations,
  sendTestAlert,
  upsertIntegration,
} from "./integrations";
import { askIncident, investigate } from "./investigator";
import { ingestTelemetryEvent } from "./ingestTelemetry";
import { computeLiveMetrics } from "./liveMetrics";
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

async function latestLiveMetrics() {
  const raw = await (await import("./redis")).redis.get("flare:metrics:live");
  if (raw) {
    try {
      return JSON.parse(raw) as Awaited<ReturnType<typeof computeLiveMetrics>>;
    } catch {
      /* fall through */
    }
  }
  return computeLiveMetrics();
}

type TrackedUrlRow = {
  code: string;
  title: string;
  updatedAt: Date;
  checkCount: number;
  latestBody: string | null;
  latestAt: Date | null;
};

async function listTrackedUrls(): Promise<
  {
    code: string;
    title: string;
    url: string;
    label: string;
    status: "up" | "down" | "unknown";
    statusCode: string | null;
    latencyMs: number | null;
    isUp: boolean | null;
    reason: string | null;
    checkedAt: string | null;
    checkCount: number;
    updatedAt: string;
  }[]
> {
  const rows = await sql<TrackedUrlRow[]>`
    SELECT
      r.code,
      r.title,
      r.updated_at AS "updatedAt",
      COALESCE(cnt.n, 0)::int AS "checkCount",
      latest.body AS "latestBody",
      latest.created_at AS "latestAt"
    FROM rooms r
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM events e
      WHERE e.room_id = r.id AND e.body LIKE ${"%External URL check%"}
    ) cnt ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.body, e.created_at FROM events e
      WHERE e.room_id = r.id AND e.body LIKE ${"%External URL check%"}
      ORDER BY e.created_at DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE r.detection_source = ${"url_check"}
    ORDER BY COALESCE(latest.created_at, r.updated_at) DESC
  `;

  return rows.map((r) => {
    const parsed = r.latestBody ? parseUrlCheckNote(r.latestBody) : null;
    const url = parsed?.url || "";
    let title = r.title.replace(/^URL check:\s*/i, "").trim();
    if (url) title = displaySiteName(url);
    else if (!title) title = r.code;
    return {
      code: r.code,
      title,
      url,
      label: url ? inferUrlLabel(url) : "Endpoint",
      status: urlCheckStatus(parsed?.isUp),
      statusCode: parsed?.statusCode && parsed.statusCode !== "—" ? parsed.statusCode : null,
      latencyMs: parsed?.latencyMs && parsed.latencyMs !== "—" ? Number(parsed.latencyMs) : null,
      isUp: parsed ? parsed.isUp : null,
      reason: parsed?.reason ?? null,
      checkedAt: parsed?.checkedAt ?? (r.latestAt ? r.latestAt.toISOString() : null),
      checkCount: r.checkCount,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
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
    const active = await sql<RoomRow[]>`
      SELECT * FROM rooms
      WHERE status != 'resolved' AND detection_source != 'url_check'
      ORDER BY updated_at DESC LIMIT 20
    `;
    const trackedUrls = await listTrackedUrls();
    const recentTimeline = await sql<
      { id: string; kind: string; summary: string; created_at: Date; code: string }[]
    >`
      SELECT ie.id, ie.kind, ie.summary, ie.created_at, r.code
      FROM incident_events ie
      JOIN rooms r ON r.id = ie.room_id
      WHERE r.detection_source != 'url_check'
      ORDER BY ie.created_at DESC
      LIMIT 15
    `;
    return c.json({
      mode: "LIVE",
      activeIncidents: active.map((r) => ({
        code: r.code,
        title: r.title,
        severity: r.severity,
        severityLabel: SEV_LABEL[r.severity] || r.severity,
        status: r.status,
        affected: r.affected ?? [],
        updatedAt: r.updated_at,
      })),
      trackedUrls,
      recentTimeline: recentTimeline.map((t) => ({
        id: t.id,
        kind: t.kind,
        summary: t.summary,
        roomCode: t.code,
        createdAt: t.created_at,
      })),
    });
  });

  app.get("/api/tracked-urls", async (c) => {
    const urls = await listTrackedUrls();
    return c.json({ urls });
  });

  app.get("/api/incidents", async (c) => {
    const rows = await sql<RoomRow[]>`
      SELECT * FROM rooms
      WHERE detection_source != 'url_check'
      ORDER BY updated_at DESC LIMIT 50
    `;
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
    const metrics = await latestLiveMetrics();
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
    const metrics = await latestLiveMetrics();
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
    const metrics = await latestLiveMetrics();
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
      const prevAffected = data.room.affected ?? [];
      const prevBlast = data.room.blast_root;
      const startedAt = data.room.created_at;
      const [r] = await sql<RoomRow[]>`
        UPDATE rooms SET status = ${"resolved"}, affected = ${[]}, blast_root = ${""},
          resolved_at = NOW(), updated_at = NOW() WHERE id = ${room.id} RETURNING *
      `;
      room = r;
      const ev = await appendIncidentEvent(room.id, "incident.resolved", `${author} resolved the incident`);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await dispatchIntegrations(
        "incident.resolved",
        roomCode,
        {
          title: room.title,
          severity: room.severity,
          status: "resolved",
          affected: prevAffected,
          blastRoot: prevBlast,
          startedAt,
          alertVariant: "resolved",
        },
        { force: true },
      );
    } else if (action === "note") {
      const text = (body.note || "").slice(0, 2000);
      if (!text) return c.json({ error: "note_required" }, 400);
      const ev = await appendIncidentEvent(room.id, "note", `${author}: ${text}`, { author });
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    } else if (action === "alert") {
      const sent = await dispatchIntegrations(
        "incident.escalated",
        roomCode,
        {
          title: room.title,
          severity: room.severity,
          status: room.status,
          affected: room.affected ?? [],
          blastRoot: room.blast_root,
        },
        { force: true },
      );
      const summary =
        sent > 0
          ? `Discord alert sent (${sent} channel(s))`
          : "Discord alert not delivered — check Integrations for webhook URL and last error";
      const ev = await appendIncidentEvent(room.id, "alert.sent", summary);
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await publish(roomCode, {
        type: "activity",
        text: sent > 0 ? "Discord alert sent" : "Discord alert failed",
      });
      const events = data.events;
      const serialized = serializeRoom(room, events);
      await publish(roomCode, { type: "room:update", room: serialized });
      return c.json({ ok: sent > 0, sent, room: serialized });
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
    try {
      const result = await ingestTelemetryEvent(
        {
          service: String(body.service || ""),
          type: String(body.type || "custom"),
          severity: String(body.severity || "medium"),
          message: String(body.message || ""),
          metadata: body.metadata || {},
        },
        { id, publish },
      );
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bad_request";
      return c.json({ error: msg }, 400);
    }
  });

  app.post("/api/check-url", checkUrlRoute);

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

  app.post("/api/integrations", async (c) => {
    const body = (await c.req.json()) as {
      kind?: string;
      name?: string;
      url?: string;
      events?: string[];
      enabled?: boolean;
    };
    if (!body.kind) return c.json({ error: "kind_required" }, 400);
    await upsertIntegration({
      kind: body.kind,
      name: body.name,
      url: body.url,
      events: body.events,
      enabled: body.enabled,
    });
    return c.json({ integrations: await listIntegrations() }, 201);
  });

  app.post("/api/integrations/test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string };
    const result = await sendTestAlert(body.kind || "discord");
    return c.json(
      {
        ok: result.ok,
        status: result.status,
        error: result.error,
        integrations: await listIntegrations(),
      },
      result.ok ? 200 : 502,
    );
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
      metrics?: MetricsSnapshot & { availability?: number; requestCount?: number };
      actions?: string[];
      service?: string;
    };
    const metrics = body.metrics;
    if (!metrics) return c.json({ error: "metrics_required" }, 400);
    const service = (body.service || "api").slice(0, 64);

    let roomCode: string | null = null;
    const [open] = await sql<RoomRow[]>`
      SELECT * FROM rooms
      WHERE status != 'resolved' AND ${service} = ANY(affected)
      ORDER BY updated_at DESC LIMIT 1
    `;
    if (open) {
      roomCode = open.code;
      const thr = await appendIncidentEvent(
        open.id,
        "metric.threshold",
        `Error threshold exceeded (${metrics.errorRate}% errors, latency ${metrics.latencyMs}ms)`,
        { ...metrics, ruleName: body.ruleName, service },
      );
      await publish(open.code, { type: "timeline:append", event: serializeIncidentEvent(thr) });
    } else if ((body.actions || []).includes("create_incident")) {
      const roomId = id();
      roomCode = code();
      const title = `${service} degradation detected`;
      await sql`
        INSERT INTO rooms (id, code, title, severity, status, affected, blast_root, detection_source)
        VALUES (
          ${roomId}, ${roomCode}, ${title}, ${"sev2"}, ${"investigating"},
          ${[service]}, ${service}, ${"automation"}
        )
      `;
      await appendIncidentEvent(
        roomId,
        "metric.threshold",
        `Error threshold exceeded (${metrics.errorRate}% errors · ${metrics.requestCount ?? "?"} reqs)`,
        { ...metrics, ruleName: body.ruleName, service },
      );
      await appendIncidentEvent(roomId, "incident.created", `Incident created by automation (${body.ruleName})`);
      await dispatchIntegrations("incident.created", roomCode, {
        title,
        severity: "sev2",
        status: "investigating",
        affected: [service],
        blastRoot: service,
        metrics: {
          errorRate: metrics.errorRate,
          latencyMs: metrics.latencyMs,
          availability: metrics.availability,
        },
        impact:
          metrics.errorRate > 25
            ? "HTTP errors / error-rate threshold exceeded"
            : "Metric threshold exceeded",
      });
      const loaded = await loadRoom(roomCode);
      if (loaded) {
        await publish(roomCode, {
          type: "room:update",
          room: serializeRoom(loaded.room, loaded.events),
        });
      }
    }

    if (roomCode && (body.actions || []).includes("discord_alert")) {
      const data = await loadRoom(roomCode);
      if (data) {
        const sent = await dispatchIntegrations("incident.created", roomCode, {
          title: data.room.title,
          severity: data.room.severity,
          status: data.room.status,
          affected: data.room.affected ?? [],
          blastRoot: data.room.blast_root,
          metrics: {
            errorRate: metrics.errorRate,
            latencyMs: metrics.latencyMs,
            availability: metrics.availability,
          },
          impact:
            metrics.errorRate > 25
              ? "HTTP errors / error-rate threshold exceeded"
              : "Metric threshold exceeded",
        });
        const ev = await appendIncidentEvent(
          data.room.id,
          "alert.sent",
          `Discord notification sent (${sent} channel(s))`,
          { ruleName: body.ruleName },
        );
        await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      }
    }

    return c.json({ ok: true, roomCode, matched: true });
  });

  app.post("/api/internal/recovery", async (c) => {
    const secret = process.env.INTERNAL_SECRET || "flare-dev";
    if (c.req.header("x-flare-secret") !== secret) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json()) as {
      metrics?: MetricsSnapshot & { availability?: number };
      service?: string;
    };
    const service = (body.service || "api").slice(0, 64);
    const open = await sql<RoomRow[]>`
      SELECT * FROM rooms
      WHERE status != 'resolved'
        AND detection_source IN ('automation', 'telemetry')
        AND (${service} = ANY(affected) OR blast_root = ${service})
    `;
    const resolved: string[] = [];
    for (const room of open) {
      const [r] = await sql<RoomRow[]>`
        UPDATE rooms SET status = ${"resolved"}, affected = ${[]}, blast_root = ${""},
          resolved_at = NOW(), updated_at = NOW() WHERE id = ${room.id} RETURNING *
      `;
      await appendIncidentEvent(
        room.id,
        "recovery.detected",
        `Recovery detected for ${service} (errorRate ${body.metrics?.errorRate ?? "?"}%, availability ${body.metrics?.availability ?? "?"})`,
        body.metrics || {},
      );
      await appendIncidentEvent(room.id, "incident.resolved", "Incident resolved — all clear");
      await dispatchIntegrations("incident.resolved", room.code, {
        title: r.title,
        severity: r.severity,
        status: "resolved",
        affected: [service],
        blastRoot: service,
        startedAt: room.created_at,
        alertVariant: "all_clear",
        metrics: body.metrics
          ? {
              errorRate: body.metrics.errorRate,
              latencyMs: body.metrics.latencyMs,
              availability: body.metrics.availability,
            }
          : null,
      });
      const loaded = await loadRoom(room.code);
      if (loaded) {
        await publish(room.code, {
          type: "room:update",
          room: serializeRoom(loaded.room, loaded.events),
        });
        await publish(room.code, { type: "activity", text: "All clear — recovery detected" });
      }
      resolved.push(room.code);
    }
    return c.json({ ok: true, resolved });
  });

  app.post("/api/internal/cleanup-test-rooms", async (c) => {
    const secret = process.env.INTERNAL_SECRET || "flare-dev";
    if (c.req.header("x-flare-secret") !== secret) return c.json({ error: "forbidden" }, 403);
    const result = await cleanupTestRooms();
    return c.json({
      ok: true,
      db: {
        host: process.env.DB_HOST || "127.0.0.1",
        name: process.env.DB_NAME || "flare",
      },
      ...result,
    });
  });
}
