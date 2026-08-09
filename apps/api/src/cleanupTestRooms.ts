import { sql } from "./db";

const PATTERNS = [
  "%sanity%",
  "%demo%",
  "%proof%",
  "%confirm%",
  "%Discord%",
  "New incident%",
  "%war room%",
  "%degradation detected%",
  "%metrics%",
  "%smoke%",
  "%thumb test%",
  "%test outage%",
  "verify-%",
  "cascade+%",
  "demo-%",
  "shop-api%",
];

export async function cleanupTestRooms() {
  const rows = await sql<{ id: string; code: string; title: string }[]>`
    SELECT id, code, title FROM rooms
    WHERE detection_source != 'url_check'
      AND (
        detection_source = 'demo'
        OR title ILIKE ${PATTERNS[0]}
        OR title ILIKE ${PATTERNS[1]}
        OR title ILIKE ${PATTERNS[2]}
        OR title ILIKE ${PATTERNS[3]}
        OR title ILIKE ${PATTERNS[4]}
        OR title ILIKE ${PATTERNS[5]}
        OR title ILIKE ${PATTERNS[6]}
        OR title ILIKE ${PATTERNS[7]}
        OR title ILIKE ${PATTERNS[8]}
        OR title ILIKE ${PATTERNS[9]}
        OR title ILIKE ${PATTERNS[10]}
        OR title ILIKE ${PATTERNS[11]}
        OR title ILIKE ${PATTERNS[12]}
        OR title ILIKE ${PATTERNS[13]}
        OR title ILIKE ${PATTERNS[14]}
        OR title ILIKE ${PATTERNS[15]}
      )
  `;
  if (!rows.length) return { deleted: 0, rooms: [] as { code: string; title: string }[] };
  const ids = rows.map((r) => r.id);
  await sql`DELETE FROM rooms WHERE id IN ${sql(ids)}`;
  return { deleted: rows.length, rooms: rows.map((r) => ({ code: r.code, title: r.title })) };
}
