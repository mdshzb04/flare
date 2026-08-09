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
import {
  ROOM_TTL_MS,
  TICK_MS,
  newRoomSim,
  tickRoom,
  type RoomSim,
} from "./metrics";

function redisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.REDIS_PORT || "6379";
  const pass = process.env.REDIS_PASSWORD;
  return pass ? `redis://:${pass}@${host}:${port}` : `redis://${host}:${port}`;
}

function dbUrl() {
  return (
    process.env.DATABASE_URL ||
    (process.env.DB_HOST
      ? `postgres://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`
      : "postgres://flare:flare@127.0.0.1:5432/flare")
  );
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

  console.log("flare-worker metrics on", `${CHANNEL}:*`);
  for (;;) {
    const now = Date.now();
    for (const [code, sim] of rooms) {
      if (now - sim.lastActivity > ROOM_TTL_MS) {
        rooms.delete(code);
        continue;
      }
      const payload = tickRoom(sim, now);
      try {
        await redisPub.publish(roomChannel(code), JSON.stringify(payload));
      } catch (err) {
        console.error("metrics publish failed", code, err);
      }
    }
    await Bun.sleep(TICK_MS);
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
  await Promise.all([thumbLoop(), metricsLoop()]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
