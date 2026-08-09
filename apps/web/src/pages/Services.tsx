import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getServices } from "../api";
import { HealthDot } from "../components/HealthDot";
import { LiveBadge } from "../components/LiveBadge";

export function Services() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getServices>>["services"]>([]);

  useEffect(() => {
    getServices().then((d) => setRows(d.services));
    const t = setInterval(() => getServices().then((d) => setRows(d.services)), 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Services</h1>
        <LiveBadge kind="DEMO" />
      </div>
      <div className="svc-grid">
        {rows.map((s) => (
          <Link key={s.id} className="card svc-card" to={`/services/${s.id}`}>
            <div className="row">
              <HealthDot status={s.status} />
              <strong>{s.name}</strong>
              <span className="muted">{s.status}</span>
            </div>
            <p className="muted" style={{ margin: "0.4rem 0 0" }}>
              {s.role}
            </p>
            <div className="mono" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
              {s.latencyMs != null ? `p50 ${Math.round(s.latencyMs)}ms` : "—"} ·{" "}
              {s.errorRate != null ? `err ${s.errorRate.toFixed(1)}%` : "—"}
              {s.queueDepth != null ? ` · q ${Math.round(s.queueDepth)}` : ""}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
