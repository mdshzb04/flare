import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getService } from "../api";
import { LiveBadge } from "../components/LiveBadge";

export function ServiceDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof getService>> | null>(null);

  useEffect(() => {
    getService(id).then(setData);
    const t = setInterval(() => getService(id).then(setData), 4000);
    return () => clearInterval(t);
  }, [id]);

  if (!data) return <p className="muted">Loading…</p>;
  const m = data.metrics as { errorRate?: number; latencyMs?: number; queueDepth?: number } | null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{data.id}</h1>
          <p className="muted">{data.role}</p>
        </div>
        <LiveBadge kind={m ? "DEMO" : "UNKNOWN"} />
      </div>
      <div className="stat-grid">
        <div className="card stat">
          <span className="muted">Latency</span>
          <strong>{m?.latencyMs != null ? `${Math.round(m.latencyMs)}ms` : "—"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Error rate</span>
          <strong>{m?.errorRate != null ? `${m.errorRate.toFixed(1)}%` : "—"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Dependencies</span>
          <strong style={{ fontSize: "1rem" }}>{data.deps.join(", ") || "none"}</strong>
        </div>
      </div>
      <div className="split-2">
        <section className="card">
          <h3>Recent telemetry</h3>
          {data.telemetry.length === 0 ? (
            <p className="muted">No ingested events for this service yet.</p>
          ) : (
            <ul className="svc-list">
              {data.telemetry.map((t) => (
                <li key={t.id}>
                  <span className="mono muted">{t.type}</span>
                  <span>{t.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3>Incidents</h3>
          <ul className="svc-list">
            {data.incidents.map((i) => (
              <li key={i.code}>
                <Link to={`/incidents/${i.code}`}>{i.title}</Link>
                <span className="muted">{i.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
