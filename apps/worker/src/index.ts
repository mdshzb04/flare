import Redis from "ioredis";
import postgres from "postgres";
import sharp from "sharp";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { matchRule, type RuleTrigger } from "./automation";
import { computeLiveMetrics, isDegraded, isRecovered, type LiveSnap } from "./liveMonitor";
import {
  ROOM_TTL_MS,
  TICK_MS,
  newRoomSim,
  tickRoom,
  type MetricsPayload,
  type RoomSim,
} from "./metrics";

function redisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.REDIS_PORT || "6379";
  const pass = process.env.REDIS_PASSWORD;
  return pass
    ? `redis://:${encodeURIComponent(pass)}@${host}:${port}`
    : `redis://${host}:${port}`;
}

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.DB_HOST) return "postgres://flare:flare@127.0.0.1:5432/flare";
  const user = encodeURIComponent(process.env.DB_USER || "flare");
  const pass = encodeURIComponent(process.env.DB_PASS || "");
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "flare";
  return `postgres://${user}:${pass}@${host}:${port}/${name}`;
}

const QUEUE = "flare:thumb:jobs";
const CHANNEL = "flare:room";
const bucket = process.env.S3_BUCKET || "flare";
const apiBase = process.env.API_INTERNAL_URL || process.env.API_URL || "http://127.0.0.1:3000";
const secret = process.env.INTERNAL_SECRET || "flare-dev";

const redis = new Redis(redisUrl(), { maxRetriesPerRequest: null });
const redisPub = new Redis(redisUrl(), { maxRetriesPerRequest: null });
const redisSub = new Redis(redisUrl(), { maxRetriesPerRequest: null });
const sql = postgres(dbUrl(), { max: 5 });

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "flareflare",
    secretAccessKey: process.env.S3_SECRET_KEY || "flareflare",
  },
});

const rooms = new Map<string, RoomSim>();
const firedRules = new Map<string, number>(); // ruleId -> last fire ts
let lastPayload: MetricsPayload | null = null; // DEMO sim only (war-room load viz)
let lastLive: LiveSnap | null = null;
let healthyStreak = 0;
let degradedStreak = 0;

function roomChannel(roomCode: string) {
  return `${CHANNEL}:${roomCode}`;
}

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      /* */
    }
  }
}

async function getBytes(key: string) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await out.Body?.transformToByteArray();
  if (!bytes) throw new Error("empty");
  return Buffer.from(bytes);
}

async function putBytes(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

async function processJob(raw: string) {
  const job = JSON.parse(raw) as { eventId: string; roomCode: string; attachmentKey: string };
  const src = await getBytes(job.attachmentKey);
  const thumb = await sharp(src).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const thumbKey = job.attachmentKey.replace(/(\.[^.]+)?$/, ".thumb.jpg");
  await putBytes(thumbKey, thumb, "image/jpeg");
  await sql`UPDATE events SET thumb_key = ${thumbKey} WHERE id = ${job.eventId}`;

  const res = await fetch(`${apiBase}/api/internal/thumb`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-flare-secret": secret },
    body: JSON.stringify({ eventId: job.eventId, roomCode: job.roomCode, thumbKey }),
  });
  if (!res.ok) {
    console.error("thumb notify failed", await res.text());
  } else {
    console.log("thumb ok", job.eventId);
  }
}

async function seedAffected(roomCode: string, sim: RoomSim) {
  try {
    const res = await fetch(`${apiBase}/api/rooms/${roomCode}`);
    if (!res.ok) return;
    const room = (await res.json()) as { affected?: string[] };
    if (Array.isArray(room.affected)) sim.affected = room.affected.map(String);
  } catch {
    /* api may still be booting */
  }
}

function touchRoom(roomCode: string, affected?: string[]) {
  let sim = rooms.get(roomCode);
  if (!sim) {
    sim = newRoomSim(affected ?? []);
    rooms.set(roomCode, sim);
    if (affected === undefined) void seedAffected(roomCode, sim);
  } else {
    if (affected) sim.affected = affected;
    sim.lastActivity = Date.now();
  }
  return sim;
}

async function metricsLoop() {
  await redisSub.psubscribe(`${CHANNEL}:*`);
  redisSub.on("pmessage", (_pattern, channel, message) => {
    const roomCode = channel.slice(CHANNEL.length + 1);
    if (!roomCode) return;
    let msg: { type?: string; room?: { affected?: string[] } };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type === "metrics") return;
    if (msg.type === "room:update" && msg.room) {
      const affected = Array.isArray(msg.room.affected) ? msg.room.affected.map(String) : [];
      touchRoom(roomCode, affected);
      return;
    }
    if (msg.type === "presence" || msg.type === "event:create" || msg.type === "event:thumb") {
      touchRoom(roomCode);
    }
  });

  console.log("flare-worker DEMO room metrics on", `${CHANNEL}:*`);
  for (;;) {
    const now = Date.now();
    // Internal war-room load sim only — not production dashboard source
    if (rooms.size === 0) {
      const orphan = newRoomSim([]);
      const payload = tickRoom(orphan, now);
      lastPayload = payload;
      await redisPub.set(
        "flare:metrics:latest",
        JSON.stringify({ ...payload, label: "DEMO", source: "demo" }),
      );
    }
    for (const [code, sim] of rooms) {
      if (now - sim.lastActivity > ROOM_TTL_MS) {
        rooms.delete(code);
        continue;
      }
      const payload = tickRoom(sim, now);
      lastPayload = payload;
      try {
        await redisPub.publish(roomChannel(code), JSON.stringify(payload));
        await redisPub.set(
          "flare:metrics:latest",
          JSON.stringify({ ...payload, label: "DEMO", source: "demo" }),
        );
      } catch (err) {
        console.error("metrics publish failed", code, err);
      }
    }
    await Bun.sleep(TICK_MS);
  }
}

async function postTelemetry(body: Record<string, unknown>) {
  await fetch(`${apiBase}/api/telemetry/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** Probe monitored /health URLs and evaluate LIVE telemetry thresholds. */
async function liveMonitorLoop() {
  console.log("flare-worker live monitor → telemetry + health probes");
  for (;;) {
    try {
      const targets = await sql<{ id: string; health_url: string }[]>`
        SELECT id, health_url FROM services
        WHERE health_url IS NOT NULL AND health_url <> ''
      `;
      for (const t of targets) {
        const t0 = Date.now();
        try {
          const res = await fetch(t.health_url, { signal: AbortSignal.timeout(5000) });
          const latencyMs = Date.now() - t0;
          await postTelemetry({
            service: t.id,
            type: "health",
            severity: res.ok ? "info" : "high",
            message: res.ok
              ? "Health check healthy"
              : `Health check failed (HTTP ${res.status})`,
            metadata: {
              latencyMs,
              status: res.status,
              availability: res.ok ? 1 : 0,
              probe: "flare-worker",
            },
          });
          if (!res.ok || latencyMs > 1500) {
            await postTelemetry({
              service: t.id,
              type: "latency",
              severity: res.ok ? "medium" : "high",
              message: res.ok
                ? `Latency increased (${latencyMs}ms)`
                : `Unhealthy response in ${latencyMs}ms`,
              metadata: { latencyMs, status: res.status },
            });
          }
        } catch (err) {
          await postTelemetry({
            service: t.id,
            type: "health",
            severity: "critical",
            message: `Health check unreachable: ${err instanceof Error ? err.message : "error"}`,
            metadata: {
              latencyMs: Date.now() - t0,
              status: 0,
              availability: 0,
              probe: "flare-worker",
            },
          });
        }
      }

      // Dashboard window (2m) + decision window (30s) so recovery isn't stuck on stale errors
      const live = await computeLiveMetrics(sql, 120);
      const recent = await computeLiveMetrics(sql, 30);
      lastLive = live;
      await redisPub.set("flare:metrics:live", JSON.stringify(live));

      // Automation / recovery from recent LIVE metrics only
      if (isDegraded(recent)) {
        degradedStreak += 1;
        healthyStreak = 0;
      } else if (isRecovered(recent)) {
        healthyStreak += 1;
        degradedStreak = 0;
      } else {
        healthyStreak = 0;
        degradedStreak = Math.max(0, degradedStreak - 1);
      }

      if (degradedStreak >= 2) {
        const rules = await sql<
          { id: string; name: string; enabled: boolean; trigger: RuleTrigger; actions: string[] }[]
        >`SELECT id, name, enabled, trigger, actions FROM automation_rules WHERE enabled = true`;
        const snap = {
          errorRate: recent.errorRate,
          latencyMs: recent.latencyMs,
          queueDepth: recent.queueDepth,
          degradedPct: recent.degradedPct,
          availability: recent.availability,
          requestCount: recent.requestCount,
        };
        for (const rule of rules) {
          if (!matchRule(rule.trigger, snap)) continue;
          const last = firedRules.get(rule.id) || 0;
          if (Date.now() - last < 60_000) continue;
          firedRules.set(rule.id, Date.now());
          await fetch(`${apiBase}/api/internal/automation-fire`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-flare-secret": secret,
            },
            body: JSON.stringify({
              ruleName: rule.name,
              metrics: snap,
              actions: rule.actions,
              service: "api",
            }),
          });
        }
      }

      if (healthyStreak >= 2) {
        const last = firedRules.get("recovery") || 0;
        if (Date.now() - last > 30_000) {
          firedRules.set("recovery", Date.now());
          await fetch(`${apiBase}/api/internal/recovery`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-flare-secret": secret,
            },
            body: JSON.stringify({ metrics: recent, service: "api" }),
          });
        }
      }
    } catch (err) {
      console.error("live monitor", err);
    }
    await Bun.sleep(5000);
  }
}

async function thumbLoop() {
  await ensureBucket();
  console.log("flare-worker listening on", QUEUE);
  for (;;) {
    const item = await redis.brpop(QUEUE, 5);
    if (!item) continue;
    try {
      await processJob(item[1]);
    } catch (err) {
      console.error("job failed", err);
    }
  }
}

async function main() {
  await Promise.all([thumbLoop(), metricsLoop(), liveMonitorLoop()]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
