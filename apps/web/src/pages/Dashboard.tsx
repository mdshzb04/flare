import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, type TrackedUrl } from "../api";
import { HealthDot } from "../components/HealthDot";

function endpointLine(u: TrackedUrl) {
  if (u.status === "unknown") return "No probe yet";
  if (u.status === "up") {
    return `${u.statusCode ?? "OK"} · ${u.latencyMs ?? "—"}ms`;
  }
  return u.reason?.replace(/_/g, " ") || `HTTP ${u.statusCode ?? "—"}`;
}

export function Dashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboard>> | null>(null);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());

  useEffect(() => {
    let dead = false;
    async function load() {
      try {
        const d = await getDashboard();
        if (!dead) {
          setData(d);
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "load failed");
      }
    }
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const ageSec = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const tracked = data?.trackedUrls || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="live-status">
            <span className="live-dot" aria-hidden />
            Tracked endpoints and open incidents
            <span className="muted"> · updated {ageSec}s ago</span>
          </p>
        </div>
        <Link className="buttonish" to="/#check-url">
          Check a URL
        </Link>
      </div>
      {err ? <p className="flash-error">{err}</p> : null}

      <div className="split-2 dash-panels">
        <section className="card panel">
          <div className="panel-head">
            <h3>Monitored endpoints</h3>
          </div>
          <p className="muted panel-copy" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
            URLs indexed from landing-page probes — status from the latest check.
          </p>
          {tracked.length === 0 ? (
            <p className="empty-hint">
              No tracked URLs yet.{" "}
              <Link to="/#check-url">Check a URL</Link> on the home page to start monitoring.
            </p>
          ) : (
            <ul className="svc-list dense">
              {tracked.map((u) => (
                <li key={u.code}>
                  <HealthDot status={u.status} />
                  <div className="endpoint-row">
                    <Link to={`/r/${u.code}`}>{u.title}</Link>
                    <span className="muted endpoint-label">{u.label}</span>
                  </div>
                  <span className={`status-chip ${u.status}`}>{u.status}</span>
                  <span className="muted endpoint-meta">{endpointLine(u)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card panel">
          <div className="panel-head">
            <h3>Active incidents</h3>
            <Link className="panel-link" to="/incidents">
              View all
            </Link>
          </div>
          {(data?.activeIncidents || []).length === 0 ? (
            <p className="empty-hint">
              None open. Create an incident room from the landing page or mark a service down in an existing war room.
            </p>
          ) : (
            <ul className="svc-list dense">
              {data!.activeIncidents.map((i) => (
                <li key={i.code} className="incident-row">
                  <span className={`sev ${i.severity}`}>{i.severityLabel}</span>
                  <Link to={`/incidents/${i.code}`}>{i.title}</Link>
                  <Link className="muted" to={`/r/${i.code}`}>
                    war room
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card panel">
        <div className="panel-head">
          <h3>Recent timeline</h3>
        </div>
        {(data?.recentTimeline || []).length === 0 ? (
          <p className="empty-hint">Timeline events appear as incidents are updated in war rooms.</p>
        ) : (
          <ul className="timeline-compact">
            {(data?.recentTimeline || []).map((t) => (
              <li key={t.id}>
                <time className="mono muted">{new Date(t.createdAt).toLocaleTimeString()}</time>
                <span>{t.summary}</span>
                <Link className="mono" to={`/incidents/${t.roomCode}`}>
                  {t.roomCode}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
