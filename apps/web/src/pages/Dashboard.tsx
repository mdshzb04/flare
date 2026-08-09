import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom, getDashboard } from "../api";
import { HealthDot } from "../components/HealthDot";
import { LiveBadge } from "../components/LiveBadge";

export function Dashboard() {
  const nav = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboard>> | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    async function load() {
      try {
        const d = await getDashboard();
        if (!dead) setData(d);
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

  async function startDemo() {
    setBusy(true);
    try {
      const { code } = await createRoom("Demo cascade — api degradation", "demo");
      nav(`/r/${code}?demo=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  const m = data?.metrics as
    | { errorRate?: number; latencyMs?: number; queueDepth?: number; degradedPct?: number; rps?: number; label?: string }
    | undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Production overview</h1>
          <p className="muted">
            Worker metrics are <LiveBadge kind="DEMO" /> simulated load — cascade and timeline are real persisted events.
          </p>
        </div>
        <button className="primary" type="button" disabled={busy} onClick={() => void startDemo()}>
          Run degradation demo
        </button>
      </div>
      {err ? <p style={{ color: "var(--sev1)" }}>{err}</p> : null}

      <div className="stat-grid">
        <div className="card stat">
          <span className="muted">Error rate</span>
          <strong>{m?.errorRate != null ? `${Number(m.errorRate).toFixed(1)}%` : "—"}</strong>
          <LiveBadge kind={m?.errorRate != null ? "DEMO" : "UNKNOWN"} />
        </div>
        <div className="card stat">
          <span className="muted">P95 latency</span>
          <strong>{m?.latencyMs != null ? `${Math.round(Number(m.latencyMs))}ms` : "—"}</strong>
          <LiveBadge kind={m?.latencyMs != null ? "DEMO" : "UNKNOWN"} />
        </div>
        <div className="card stat">
          <span className="muted">Queue depth</span>
          <strong>{m?.queueDepth != null ? Math.round(Number(m.queueDepth)) : "—"}</strong>
          <LiveBadge kind={m?.queueDepth != null ? "DEMO" : "UNKNOWN"} />
        </div>
        <div className="card stat">
          <span className="muted">Stack degraded</span>
          <strong>{m?.degradedPct != null ? `${m.degradedPct}%` : "—"}</strong>
          <LiveBadge kind={m?.degradedPct != null ? "DEMO" : "UNKNOWN"} />
        </div>
      </div>

      <div className="split-2">
        <section className="card">
          <h3>Services</h3>
          <ul className="svc-list">
            {(data?.services || []).map((s) => (
              <li key={s.id}>
                <HealthDot status={s.status} />
                <Link to={`/services/${s.id}`}>{s.id}</Link>
                <span className="muted">{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h3>Active incidents</h3>
          {(data?.activeIncidents || []).length === 0 ? (
            <p className="muted">None open. Run the demo or create an incident.</p>
          ) : (
            <ul className="svc-list">
              {data!.activeIncidents.map((i) => (
                <li key={i.code}>
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

      <section className="card">
        <h3>Recent timeline</h3>
        <ul className="svc-list">
          {(data?.recentTimeline || []).map((t) => (
            <li key={t.id}>
              <span className="mono muted">{new Date(t.createdAt).toLocaleTimeString()}</span>
              <span>{t.summary}</span>
              <Link to={`/incidents/${t.roomCode}`}>{t.roomCode}</Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
