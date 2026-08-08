import { useEffect, useState } from "react";
import { ArchService, Health, getArchitecture, getHealth } from "../api";

const FALLBACK: ArchService[] = [
  { name: "frontend", role: "Static React SPA (public)" },
  { name: "api", role: "Hono HTTP + WebSocket (public)" },
  { name: "worker", role: "Thumbnail jobs via Valkey queue (private)" },
  { name: "db", role: "PostgreSQL persistence (private)" },
  { name: "redis", role: "Valkey pub/sub + queue (private)" },
  { name: "storage", role: "S3-compatible object storage" },
];

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
  const [services, setServices] = useState<ArchService[]>(FALLBACK);
  const [platform, setPlatform] = useState("Zerops");
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    getArchitecture()
      .then((d) => {
        setServices(d.services);
        setPlatform(d.platform);
      })
      .catch(() => {});

    function tick() {
      getHealth()
        .then(setHealth)
        .catch(() => setHealth(null));
    }
    tick();
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="hero">
      <div className="eyebrow">Live · polled every 8s</div>
      <h1>Architecture</h1>
      <p className="lede">
        Flare is six services on {platform}. Public edge is frontend + api. Everything else stays on
        the private network — the part that makes this more than a chat toy.
      </p>

      <div className="flow" style={{ marginBottom: "0.5rem" }}>
        <b>browser</b> → <b>frontend</b> → <b>api</b> → <b>postgres</b> / <b>valkey</b> / <b>storage</b> →{" "}
        <b>worker</b>
      </div>

      <div className="arch-grid">
        {services.map((s) => {
          const st = statusFor(s.name, health);
          return (
            <article key={s.name} className="card arch-item">
              <h3>{s.name}</h3>
              <p>{s.role}</p>
              <div className="health-row">
                <span className={`dot ${st === "up" ? "up" : st === "down" ? "down" : ""}`} />
                <span className="muted">
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
