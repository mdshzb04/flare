import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getIncident, incidentAction, type Investigation, type TimelineEvent } from "../api";
import { InvestigatorPanel } from "../components/InvestigatorPanel";
import { Timeline } from "../components/Timeline";

export function IncidentDetail() {
  const { code = "" } = useParams();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [affected, setAffected] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [report, setReport] = useState<Investigation | null>(null);
  const [err, setErr] = useState("");

  async function reload() {
    const d = await getIncident(code);
    setTitle(d.incident.title);
    setStatus(d.incident.status);
    setSeverity(d.incident.severityLabel || d.incident.severity);
    setAffected(d.incident.affected ?? []);
    setTimeline(d.timeline);
    setReport(d.investigation);
  }

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, [code]);

  async function act(action: string) {
    await incidentAction(code, action, { author: localStorage.getItem("flare:name") || "operator" });
    await reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted mono">{code}</p>
          <h1>{title || "Incident"}</h1>
          <p className="muted">
            {severity} · {status} · affected {affected.join(", ") || "none"}
          </p>
        </div>
        <div className="row">
          <Link className="buttonish" to={`/r/${code}`}>
            Open war room
          </Link>
          <button type="button" onClick={() => void act("investigate")}>
            Investigate
          </button>
          <button type="button" onClick={() => void act("mitigate")}>
            Mitigate
          </button>
          <button type="button" onClick={() => void act("alert")}>
            Send alert
          </button>
          <button className="primary" type="button" onClick={() => void act("resolve")}>
            Resolve
          </button>
        </div>
      </div>
      {err ? <p style={{ color: "var(--sev1)" }}>{err}</p> : null}
      <div className="split-2">
        <section className="card">
          <h3>Timeline</h3>
          <Timeline items={timeline} />
        </section>
        <section className="card">
          <InvestigatorPanel code={code} report={report} />
        </section>
      </div>
    </>
  );
}
