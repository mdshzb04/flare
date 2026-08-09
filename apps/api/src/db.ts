import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgres://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`
    : "postgres://flare:flare@127.0.0.1:5432/flare");

export const sql = postgres(url, { max: 10 });

const SERVICE_SEED: { id: string; role: string; deps: string[] }[] = [
  { id: "frontend", role: "SPA", deps: ["api"] },
  { id: "api", role: "HTTP + WS", deps: ["db", "redis", "storage"] },
  { id: "worker", role: "jobs", deps: ["redis", "db", "storage", "api"] },
  { id: "db", role: "Postgres", deps: [] },
  { id: "redis", role: "Valkey", deps: [] },
  { id: "storage", role: "S3", deps: [] },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled incident',
  severity TEXT NOT NULL DEFAULT 'sev2',
  status TEXT NOT NULL DEFAULT 'investigating',
  assignee TEXT NOT NULL DEFAULT '',
  affected TEXT[] NOT NULL DEFAULT '{}',
  blast_root TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'anon',
  attachment_key TEXT,
  thumb_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_room_id_idx ON events(room_id, created_at);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT '',
  deps TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_events_room_idx ON incident_events(room_id, created_at);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telemetry_events_created_idx ON telemetry_events(created_at DESC);

CREATE TABLE IF NOT EXISTS metric_samples (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  service TEXT NOT NULL DEFAULT '',
  rps DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  error_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  queue_depth DOUBLE PRECISION NOT NULL DEFAULT 0,
  degraded_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'demo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}',
  events TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function migrate() {
  await sql.unsafe(SCHEMA);
  await sql.unsafe(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS affected TEXT[] NOT NULL DEFAULT '{}'`);
  await sql.unsafe(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS blast_root TEXT NOT NULL DEFAULT ''`);
  await sql.unsafe(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS detection_source TEXT NOT NULL DEFAULT 'manual'`);
  await sql.unsafe(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);

  for (const s of SERVICE_SEED) {
    await sql`
      INSERT INTO services (id, role, deps)
      VALUES (${s.id}, ${s.role}, ${s.deps})
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, deps = EXCLUDED.deps
    `;
  }

  // Seed Discord integration from env if none exists
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM integrations WHERE kind = 'discord' LIMIT 1
  `;
  if (!existing) {
    const url = (process.env.DISCORD_WEBHOOK_URL || "").trim();
    await sql`
      INSERT INTO integrations (id, kind, name, config, events, enabled)
      VALUES (
        ${crypto.randomUUID()},
        ${"discord"},
        ${"Discord"},
        ${sql.json({ url })},
        ${["incident.created", "service.degraded", "incident.resolved", "incident.escalated"]},
        ${Boolean(url)}
      )
    `;
  }

  const [rule] = await sql<{ id: string }[]>`SELECT id FROM automation_rules LIMIT 1`;
  if (!rule) {
    await sql`
      INSERT INTO automation_rules (id, name, enabled, trigger, actions)
      VALUES (
        ${crypto.randomUUID()},
        ${"High error rate"},
        ${true},
        ${sql.json({ metric: "errorRate", op: "gt", value: 8 })},
        ${sql.json(["create_incident", "discord_alert"])}
      )
    `;
  }
}
