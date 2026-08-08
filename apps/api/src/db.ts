import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgres://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`
    : "postgres://flare:flare@127.0.0.1:5432/flare");

export const sql = postgres(url, { max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled incident',
  severity TEXT NOT NULL DEFAULT 'sev2',
  status TEXT NOT NULL DEFAULT 'investigating',
  assignee TEXT NOT NULL DEFAULT '',
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
`;

export async function migrate() {
  await sql.unsafe(SCHEMA);
}
