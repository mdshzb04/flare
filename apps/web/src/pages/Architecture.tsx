import { useEffect, useState } from "react";
import { ArchService, getArchitecture } from "../api";

const FALLBACK: ArchService[] = [
  { name: "frontend", role: "Static React SPA (public)" },
  { name: "api", role: "Hono HTTP + WebSocket (public)" },
  { name: "worker", role: "Thumbnail jobs via Valkey queue (private)" },
  { name: "db", role: "PostgreSQL persistence (private)" },
  { name: "redis", role: "Valkey pub/sub + queue (private)" },
  { name: "storage", role: "S3-compatible object storage" },
];

export function Architecture() {
  const [services, setServices] = useState<ArchService[]>(FALLBACK);
  const [platform, setPlatform] = useState("Zerops");

  useEffect(() => {
    getArchitecture()
      .then((d) => {
        setServices(d.services);
        setPlatform(d.platform);
      })
      .catch(() => {
        /* offline fallback */
      });
  }, []);

  return (
    <section className="hero">
      <h1>Architecture</h1>
      <p>
        Flare runs as six services on {platform}. Only frontend and api are public; the rest talk
        over the private network.
      </p>
      <div className="arch-grid">
        {services.map((s) => (
          <article key={s.name} className="card arch-item">
            <h3>{s.name}</h3>
            <p>{s.role}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
