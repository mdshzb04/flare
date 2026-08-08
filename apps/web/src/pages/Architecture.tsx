import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArchService, Health, Room, getArchitecture, getHealth, getRoom } from "../api";
import { BlastMap } from "../components/BlastMap";

const FALLBACK: ArchService[] = [
  { name: "frontend", role: "Static React SPA (public)" },
  { name: "api", role: "Hono HTTP + WebSocket (public)" },
  { name: "worker", role: "Thumbnail jobs via Valkey queue (private)" },
  { name: "db", role: "PostgreSQL persistence (private)" },
  { name: "redis", role: "Valkey pub/sub + queue (private)" },
  { name: "storage", role: "S3-compatible object storage" },
];

const LAST_ROOM_KEY = "flare:lastRoom";

function statusFor(name: string, health: Health | null): "up" | "down" | "unknown" {
  if (!health) return "unknown";
  if (name === "api" || name === "frontend") return health.ok ? "up" : "down";
  if (name === "db") return health.checks.postgres ? "up" : "down";
  if (name === "redis") return health.checks.valkey ? "up" : "down";
  if (name === "storage") return health.checks.storage ? "up" : "down";
  if (name === "worker") return health.checks.valkey ? "up" : "unknown";
  return "unknown";
}

export function Architecture() {
  const [params] = useSearchParams();
  const roomCode = useMemo(
    () => params.get("room") || localStorage.getItem(LAST_ROOM_KEY) || "",
    [params],
  );
  const [services, setServices] = useState<ArchService[]>(FALLBACK);
  const [platform, setPlatform] = useState("Zerops");
  const [health, setHealth] = useState<Health | null>(null);
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    getArchitecture()
      .then((d) => {
        setServices(d.services);
        setPlatform(d.platform);
      })
      .catch(() => {});

    function tickHealth() {
      getHealth()
        .then(setHealth)
        .catch(() => setHealth(null));
    }
    tickHealth();
    const id = setInterval(tickHealth, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!roomCode) {
      setRoom(null);
      return;
    }
    let dead = false;
    function load() {
      getRoom(roomCode)
        .then((r) => {
          if (!dead) setRoom({ ...r, affected: r.affected ?? [] });
        })
        .catch(() => {
          if (!dead) setRoom(null);
        });
    }
    load();
    const id = setInterval(load, 1000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [roomCode]);

  return (
    <section className="hero">
      <div className="eyebrow">Live · blast radius syncs via Valkey</div>
      <h1>Architecture</h1>
      <p className="lede">
        Six services on {platform}. Mark impact in a room — every open Architecture view and war-room
        sees the blast radius pulse within a second.
      </p>

      {roomCode ? (
        <div className="card glow">
          <BlastMap affected={room?.affected ?? []} title={`Blast radius · room ${roomCode}`} />
          <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem" }}>
            Toggle services in the{" "}
            <Link to={`/r/${roomCode}`}>war-room</Link> — this map auto-refreshes.
          </p>
        </div>
      ) : (
        <p className="muted">
          Open a <Link to="/">war-room</Link> first, then come back — blast radius binds to your last
          room.
        </p>
      )}

      <div className="flow" style={{ marginTop: "0.5rem" }}>
        <b>browser</b> → <b>frontend</b> → <b>api</b> → <b>postgres</b> / <b>valkey</b> / <b>storage</b>{" "}
        → <b>worker</b>
      </div>

      <div className="arch-grid">
        {services.map((s) => {
          const st = statusFor(s.name, health);
          const hit = (room?.affected ?? []).includes(s.name);
          return (
            <article key={s.name} className={`card arch-item ${hit ? "hit-border" : ""}`}>
              <h3>{s.name}</h3>
              <p>{s.role}</p>
              <div className="health-row">
                <span className={`dot ${st === "up" ? "up" : st === "down" ? "down" : ""}`} />
                <span className="muted">
                  {hit ? "in blast radius · " : ""}
                  {st === "up" ? "healthy" : st === "down" ? "degraded" : "not probed"}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
