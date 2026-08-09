#!/usr/bin/env bun
/** One-shot cleanup of seeded test/demo incident rooms. Keeps url_check rooms. */
import { sql } from "../apps/api/src/db";
import { cleanupTestRooms } from "../apps/api/src/cleanupTestRooms";

async function main() {
  const host = process.env.DB_HOST || process.env.DATABASE_URL?.includes("@") ? "from DATABASE_URL" : "127.0.0.1";
  const name = process.env.DB_NAME || "flare";
  console.log(`Target DB: host=${host} database=${name}`);
  const result = await cleanupTestRooms();
  if (!result.deleted) {
    console.log("No test rooms matched — nothing to delete.");
  } else {
    console.log(`Deleting ${result.deleted} test room(s):`);
    for (const r of result.rooms) console.log(`  - ${r.code} · ${r.title}`);
    console.log("Done.");
  }
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
