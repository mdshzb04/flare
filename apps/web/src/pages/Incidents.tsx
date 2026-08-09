import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom, getIncidents } from "../api";

export function Incidents() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getIncidents>>["incidents"]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getIncidents()
      .then((d) => setRows(d.incidents))
      .catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Incidents</h1>
        <button
          className="primary"
          type="button"
          onClick={() =>
            void createRoom("New incident").then((r) => nav(`/incidents/${r.code}`))
          }
        >
          Open incident
        </button>
      </div>
      {err ? <p style={{ color: "var(--sev1)" }}>{err}</p> : null}
      <div className="card panel">
        {rows.length === 0 ? (
          <p className="empty-hint">No incidents yet. Open a war room from the landing page to start one.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Title</th>
                <th>Status</th>
                <th>Source</th>
                <th>Affected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>
                    <span className={`sev ${r.severity}`}>{r.severityLabel}</span>
                  </td>
                  <td>
                    <Link to={`/incidents/${r.code}`}>{r.title}</Link>
                  </td>
                  <td>
                    <span className={`status-chip ${r.status}`}>{r.status}</span>
                  </td>
                  <td className="muted">{r.detectionSource}</td>
                  <td className="mono">{r.affected.join(", ") || "—"}</td>
                  <td>
                    <Link to={`/r/${r.code}`}>war room</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
