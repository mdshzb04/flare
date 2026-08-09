import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerWebSocket } from "bun";
import { migrate, sql } from "./db";
import { notifyAffectedTransition } from "./integrations";
import { registerOtlpRoutes } from "./otlp";
import { registerProductRoutes } from "./product";
import { appendIncidentEvent, serializeIncidentEvent } from "./timeline";
import { CHANNEL, QUEUE, ensureRedis, redis, redisSub } from "./redis";
import { ensureBucket, putObject, publicUrl } from "./s3";

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

type EventRow = {
  id: string;
  room_id: string;
  kind: string;
  body: string;
  author: string;
  attachment_key: string | null;
  thumb_key: string | null;
  created_at: Date;
};

type ClientData = { roomCode: string; name: string };

const id = () => crypto.randomUUID();
const code = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

function roomChannel(roomCode: string) {
  return `${CHANNEL}:${roomCode}`;
}

const sockets = new Map<string, Set<ServerWebSocket<ClientData>>>();

function addSocket(roomCode: string, ws: ServerWebSocket<ClientData>) {
  let set = sockets.get(roomCode);
  if (!set) {
    set = new Set();
    sockets.set(roomCode, set);
  }
  set.add(ws);
}

function removeSocket(roomCode: string, ws: ServerWebSocket<ClientData>) {
  const set = sockets.get(roomCode);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sockets.delete(roomCode);
}

function localBroadcast(roomCode: string, payload: unknown, except?: ServerWebSocket<ClientData>) {
  const set = sockets.get(roomCode);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws === except) continue;
    try {
      ws.send(msg);
    } catch {
      /* closed */
    }
  }
}

async function publish(roomCode: string, payload: unknown) {
  // fan-out via Valkey so every api instance (incl. this one) delivers once
  await redis.publish(roomChannel(roomCode), JSON.stringify(payload));
}

function presence(roomCode: string) {
  const set = sockets.get(roomCode);
  const names = set ? [...set].map((s) => s.data.name).filter(Boolean) : [];
  return [...new Set(names)];
}

async function loadRoom(roomCode: string) {
  const [room] = await sql<RoomRow[]>`SELECT * FROM rooms WHERE code = ${roomCode} LIMIT 1`;
  if (!room) return null;
  const events = await sql<EventRow[]>`
    SELECT * FROM events WHERE room_id = ${room.id} ORDER BY created_at ASC LIMIT 200
  `;
  return { room, events };
}

const ALLOWED_AFFECTED = new Set(["frontend", "api", "worker", "db", "redis", "storage"]);

function normalizeAffected(input: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(input)) return fallback;
  return [...new Set(input.map(String).filter((s) => ALLOWED_AFFECTED.has(s)))];
}

function serializeRoom(room: RoomRow, events: EventRow[]) {
  return {
    id: room.id,
    code: room.code,
    title: room.title,
    severity: room.severity,
    status: room.status,
    assignee: room.assignee,
    affected: room.affected ?? [],
    blastRoot: room.blast_root || null,
    detectionSource: room.detection_source || "manual",
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      author: e.author,
      attachmentUrl: e.attachment_key ? publicUrl(e.attachment_key) : null,
      thumbUrl: e.thumb_key ? publicUrl(e.thumb_key) : null,
      createdAt: e.created_at,
    })),
  };
}

const corsOrigin = process.env.CORS_ORIGIN || "*";

const app = new Hono();
app.use(
  "*",
  cors({
    origin: corsOrigin === "*" ? "*" : corsOrigin.split(","),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-flare-secret"],
  }),
);

registerProductRoutes(app, {
  publish,
  loadRoom: loadRoom as never,
  serializeRoom: serializeRoom as never,
  id,
  code,
});
registerOtlpRoutes(app, { id, publish });

app.get("/health", async (c) => {
  let db = false;
  let cache = false;
  try {
    await sql`SELECT 1`;
    db = true;
  } catch {
    /* */
  }
  try {
    await redis.ping();
    cache = true;
  } catch {
    /* */
  }
  const ok = db && cache;
  return c.json(
    {
      ok,
      service: "flare-api",
      checks: { postgres: db, valkey: cache, storage: true },
      architecture: ["frontend", "api", "worker", "postgres", "valkey", "object_storage"],
    },
    ok ? 200 : 503,
  );
});

app.get("/api/architecture", (c) =>
  c.json({
    name: "Flare",
    platform: "Zerops",
    services: [
      { name: "frontend", role: "Static React SPA (public)" },
      { name: "api", role: "Hono HTTP + WebSocket (public)" },
      { name: "worker", role: "Thumbnail jobs via Valkey queue (private)" },
      { name: "db", role: "PostgreSQL persistence (private)" },
      { name: "redis", role: "Valkey pub/sub + queue (private)" },
      { name: "storage", role: "S3-compatible object storage" },
    ],
  }),
);

app.post("/api/rooms", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; detectionSource?: string };
  const roomId = id();
  const roomCode = code();
  const title = (body.title || "Untitled incident").slice(0, 120);
  const detectionSource = (body.detectionSource || "manual").slice(0, 32);
  await sql`
    INSERT INTO rooms (id, code, title, detection_source)
    VALUES (${roomId}, ${roomCode}, ${title}, ${detectionSource})
  `;
  // Demo seeds only for manual/demo war rooms — not URL checks or automation incidents.
  if (detectionSource === "manual" || detectionSource === "demo") {
    const seeds = [
      {
        id: id(),
        body: "Checked pgbouncer — connection pool exhausted at 14:32 UTC, restarting service.",
        author: "oncall",
      },
      {
        id: id(),
        body: "Confirmed — Valkey pub/sub backlog climbing. Investigating worker lag on job consumers.",
        author: "platform",
      },
      {
        id: id(),
        body: "Frontend still up. Holding sev2 until blast radius is mapped — watch live error rate on the blast map.",
        author: "sre",
      },
    ];
    for (const s of seeds) {
      await sql`
        INSERT INTO events (id, room_id, kind, body, author)
        VALUES (${s.id}, ${roomId}, ${"note"}, ${s.body}, ${s.author})
      `;
    }
  }
  await appendIncidentEvent(roomId, "incident.created", `Incident opened: ${title}`, {
    detectionSource,
  });
  return c.json({ code: roomCode, urlPath: `/r/${roomCode}` }, 201);
});

app.get("/api/rooms/:code", async (c) => {
  const data = await loadRoom(c.req.param("code"));
  if (!data) return c.json({ error: "not_found" }, 404);
  return c.json(serializeRoom(data.room, data.events));
});

app.patch("/api/rooms/:code", async (c) => {
  const roomCode = c.req.param("code");
  const body = (await c.req.json()) as {
    title?: string;
    severity?: Severity;
    status?: Status;
    assignee?: string;
    affected?: string[];
    blastRoot?: string | null;
  };
  const data = await loadRoom(roomCode);
  if (!data) return c.json({ error: "not_found" }, 404);
  const prevAffected = data.room.affected ?? [];

  const title = body.title?.slice(0, 120) ?? data.room.title;
  const severity = body.severity ?? data.room.severity;
  const status = body.status ?? data.room.status;
  const assignee = body.assignee?.slice(0, 64) ?? data.room.assignee;
  const affected = normalizeAffected(body.affected, data.room.affected ?? []);
  const blastRoot =
    body.blastRoot === null
      ? ""
      : body.blastRoot !== undefined
        ? String(body.blastRoot).slice(0, 32)
        : data.room.blast_root || "";

  const resolvedAt =
    status === "resolved" ? new Date() : status !== "resolved" ? null : data.room.resolved_at;
  const [room] = await sql<RoomRow[]>`
    UPDATE rooms
    SET title = ${title}, severity = ${severity}, status = ${status},
        assignee = ${assignee}, affected = ${affected}, blast_root = ${blastRoot},
        resolved_at = CASE WHEN ${status} = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE NULL END,
        updated_at = NOW()
    WHERE id = ${data.room.id}
    RETURNING *
  `;
  const serialized = serializeRoom(room, data.events);
  const payload = { type: "room:update", room: serialized };
  await publish(roomCode, payload);

  // Timeline: cascade hops + status
  if (affected.length > prevAffected.length) {
    const added = affected.filter((a) => !prevAffected.includes(a));
    for (const svc of added) {
      const ev = await appendIncidentEvent(
        room.id,
        "cascade.hop",
        `${svc} entered blast radius`,
        { service: svc, affected },
      );
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    }
    if (prevAffected.length === 0) {
      const ev = await appendIncidentEvent(
        room.id,
        "service.degraded",
        `Cascade started at ${blastRoot || added[0]}`,
        { blastRoot, affected },
      );
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
      await publish(roomCode, { type: "activity", text: "Cascade started" });
    }
  } else if (affected.length < prevAffected.length) {
    const removed = prevAffected.filter((a) => !affected.includes(a));
    for (const svc of removed) {
      const ev = await appendIncidentEvent(room.id, "affected.changed", `${svc} recovered`, {
        service: svc,
      });
      await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    }
  }
  if (status !== data.room.status) {
    const ev = await appendIncidentEvent(room.id, `status.${status}`, `Status → ${status}`);
    await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
  }

  const sent = await notifyAffectedTransition(roomCode, prevAffected, serialized);
  if (prevAffected.length === 0 && affected.length > 0) {
    const summary =
      sent > 0
        ? `Discord alert sent (${sent} channel(s)) — service.degraded`
        : "Discord alert not delivered — check Integrations for webhook URL and last error";
    const ev = await appendIncidentEvent(room.id, "alert.sent", summary);
    await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    if (sent > 0) {
      await publish(roomCode, { type: "activity", text: "Discord alert sent" });
    }
  } else if (prevAffected.length > 0 && affected.length === 0) {
    const summary =
      sent > 0
        ? `Discord all-clear sent (${sent} channel(s))`
        : "Discord all-clear not delivered — check Integrations for webhook URL and last error";
    const ev = await appendIncidentEvent(room.id, "alert.sent", summary);
    await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
    if (sent > 0) {
      await publish(roomCode, { type: "activity", text: "Discord all-clear sent" });
    }
  }
  void resolvedAt;
  return c.json(serialized);
});

app.post("/api/rooms/:code/events", async (c) => {
  const roomCode = c.req.param("code");
  const data = await loadRoom(roomCode);
  if (!data) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json()) as {
    body?: string;
    author?: string;
    kind?: string;
    attachmentKey?: string;
  };
  const eventId = id();
  const text = (body.body || "").slice(0, 4000);
  const author = (body.author || "anon").slice(0, 64);
  const kind = (body.kind || "note").slice(0, 32);
  const attachmentKey = body.attachmentKey || null;

  const [event] = await sql<EventRow[]>`
    INSERT INTO events (id, room_id, kind, body, author, attachment_key)
    VALUES (${eventId}, ${data.room.id}, ${kind}, ${text}, ${author}, ${attachmentKey})
    RETURNING *
  `;

  if (attachmentKey) {
    await redis.lpush(QUEUE, JSON.stringify({ eventId, roomCode, attachmentKey }));
  }

  const payload = {
    type: "event:create",
    event: {
      id: event.id,
      kind: event.kind,
      body: event.body,
      author: event.author,
      attachmentUrl: event.attachment_key ? publicUrl(event.attachment_key) : null,
      thumbUrl: null,
      createdAt: event.created_at,
    },
  };
  await publish(roomCode, payload);
  return c.json(payload.event, 201);
});

app.post("/api/rooms/:code/upload", async (c) => {
  const roomCode = c.req.param("code");
  const data = await loadRoom(roomCode);
  if (!data) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData();
  const file = form.get("file");
  const author = String(form.get("author") || "anon").slice(0, 64);
  const note = String(form.get("body") || "Uploaded screenshot").slice(0, 4000);
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const key = `rooms/${roomCode}/${id()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await putObject(key, bytes, file.type || "application/octet-stream");

  const eventId = id();
  const [event] = await sql<EventRow[]>`
    INSERT INTO events (id, room_id, kind, body, author, attachment_key)
    VALUES (${eventId}, ${data.room.id}, ${"attachment"}, ${note}, ${author}, ${key})
    RETURNING *
  `;
  await redis.lpush(QUEUE, JSON.stringify({ eventId, roomCode, attachmentKey: key }));

  const payload = {
    type: "event:create",
    event: {
      id: event.id,
      kind: event.kind,
      body: event.body,
      author: event.author,
      attachmentUrl: publicUrl(key),
      thumbUrl: null,
      createdAt: event.created_at,
    },
  };
  await publish(roomCode, payload);
  return c.json(payload.event, 201);
});

// worker callback: thumb ready
app.post("/api/internal/thumb", async (c) => {
  const secret = process.env.INTERNAL_SECRET || "flare-dev";
  if (c.req.header("x-flare-secret") !== secret) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json()) as { eventId: string; roomCode: string; thumbKey: string };
  await sql`UPDATE events SET thumb_key = ${body.thumbKey} WHERE id = ${body.eventId}`;
  await publish(body.roomCode, {
    type: "event:thumb",
    eventId: body.eventId,
    thumbUrl: publicUrl(body.thumbKey),
  });
  return c.json({ ok: true });
});

export type { ClientData };

const port = Number(process.env.PORT || 3000);

async function boot() {
  await migrate();
  await ensureRedis();
  await ensureBucket();

  // cross-instance fan-out: ignore messages this process already local-broadcast
  await redisSub.psubscribe(`${CHANNEL}:*`);
  redisSub.on("pmessage", (_pattern, channel, message) => {
    const roomCode = channel.slice(CHANNEL.length + 1);
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    // re-broadcast to local sockets only (other instances already published)
    localBroadcast(roomCode, payload);
  });

  const server = Bun.serve<ClientData>({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const roomCode = url.searchParams.get("room") || "";
        const name = (url.searchParams.get("name") || "anon").slice(0, 64);
        if (!roomCode) return new Response("room required", { status: 400 });
        const ok = server.upgrade(req, { data: { roomCode, name } });
        return ok ? undefined : new Response("upgrade failed", { status: 500 });
      }
      return app.fetch(req, server);
    },
    websocket: {
      open(ws) {
        addSocket(ws.data.roomCode, ws);
        void publish(ws.data.roomCode, { type: "presence", names: presence(ws.data.roomCode) });
        void publish(ws.data.roomCode, {
          type: "activity",
          text: `${ws.data.name} joined the war room`,
        });
      },
      async message(ws, raw) {
        let msg: {
          type?: string;
          body?: string;
          title?: string;
          severity?: string;
          status?: string;
          assignee?: string;
          affected?: string[];
          blastRoot?: string | null;
        };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        const roomCode = ws.data.roomCode;
        const data = await loadRoom(roomCode);
        if (!data) {
          ws.send(JSON.stringify({ type: "error", error: "not_found" }));
          return;
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (msg.type === "event:create") {
          const eventId = id();
          const text = (msg.body || "").slice(0, 4000);
          const [event] = await sql<EventRow[]>`
            INSERT INTO events (id, room_id, kind, body, author)
            VALUES (${eventId}, ${data.room.id}, ${"note"}, ${text}, ${ws.data.name})
            RETURNING *
          `;
          await publish(roomCode, {
            type: "event:create",
            event: {
              id: event.id,
              kind: event.kind,
              body: event.body,
              author: event.author,
              attachmentUrl: null,
              thumbUrl: null,
              createdAt: event.created_at,
            },
          });
          return;
        }

        if (msg.type === "room:update") {
          const prevAffected = data.room.affected ?? [];
          const title = (msg.title ?? data.room.title).slice(0, 120);
          const severity = (msg.severity ?? data.room.severity) as Severity;
          const status = (msg.status ?? data.room.status) as Status;
          const assignee = (msg.assignee ?? data.room.assignee).slice(0, 64);
          const affected = normalizeAffected(msg.affected, data.room.affected ?? []);
          const blastRoot =
            msg.blastRoot === null
              ? ""
              : msg.blastRoot !== undefined
                ? String(msg.blastRoot).slice(0, 32)
                : data.room.blast_root || "";
          const [room] = await sql<RoomRow[]>`
            UPDATE rooms
            SET title = ${title}, severity = ${severity}, status = ${status},
                assignee = ${assignee}, affected = ${affected}, blast_root = ${blastRoot},
                updated_at = NOW()
            WHERE id = ${data.room.id}
            RETURNING *
          `;
          const events = await sql<EventRow[]>`
            SELECT * FROM events WHERE room_id = ${room.id} ORDER BY created_at ASC LIMIT 200
          `;
          const serialized = serializeRoom(room, events);
          await publish(roomCode, { type: "room:update", room: serialized });
          if (affected.length > prevAffected.length) {
            const added = affected.filter((a) => !prevAffected.includes(a));
            for (const svc of added) {
              const ev = await appendIncidentEvent(room.id, "cascade.hop", `${svc} entered blast radius`, {
                service: svc,
              });
              await publish(roomCode, { type: "timeline:append", event: serializeIncidentEvent(ev) });
            }
          }
          void notifyAffectedTransition(roomCode, prevAffected, serialized);
        }
      },
      close(ws) {
        removeSocket(ws.data.roomCode, ws);
        void publish(ws.data.roomCode, { type: "presence", names: presence(ws.data.roomCode) });
      },
    },
  });

  console.log(`flare-api on :${server.port}`);
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});
