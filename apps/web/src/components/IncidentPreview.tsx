import { useEffect, useState } from "react";

type Phase = "healthy" | "incident" | "timeline" | "resolved";

const PHASES: Phase[] = ["healthy", "incident", "timeline", "resolved"];

const TIMELINE = [
  { t: "10:42:18", text: "Error rate increased" },
  { t: "10:42:21", text: "Threshold exceeded" },
  { t: "10:42:22", text: "Incident created" },
  { t: "10:42:23", text: "War room opened" },
];

/** Product preview only — not live production telemetry. */
export function IncidentPreview() {
  const [phase, setPhase] = useState<Phase>("healthy");
  const [step, setStep] = useState(0);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      setPhase("timeline");
      setStep(TIMELINE.length);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % PHASES.length;
      setPhase(PHASES[i]);
      setStep(0);
    }, 4200);
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => {
    if (reduced || phase !== "timeline") return;
    setStep(0);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= TIMELINE.length) window.clearInterval(id);
    }, 700);
    return () => window.clearInterval(id);
  }, [phase, reduced]);

  return (
    <div className="preview-panel" aria-label="Product preview of an incident lifecycle">
      <div className="preview-chrome">
        <span className="preview-dot" />
        <span className="preview-dot" />
        <span className="preview-dot" />
        <span className="preview-chrome-label">Product preview · not live data</span>
      </div>

      <div className="preview-body">
        <div className="preview-meta">
          <span>SERVICE HEALTH</span>
          <span className={`preview-phase-tag ${phase}`}>{phaseLabel(phase)}</span>
        </div>

        <ul className="preview-svcs">
          <li>
            <span className={`ph-dot ${phase === "healthy" || phase === "resolved" ? "ok" : "down"}`} />
            <span>API</span>
            <strong>{phase === "healthy" || phase === "resolved" ? "HEALTHY" : "DEGRADED"}</strong>
          </li>
          <li>
            <span className="ph-dot ok" />
            <span>WORKER</span>
            <strong>HEALTHY</strong>
          </li>
          <li>
            <span className="ph-dot ok" />
            <span>DATABASE</span>
            <strong>HEALTHY</strong>
          </li>
        </ul>

        {(phase === "incident" || phase === "timeline") && (
          <div className="preview-alert">
            <strong>INCIDENT DETECTED</strong>
            <p>
              API · HTTP 500 errors <span className="up">↑</span>
            </p>
          </div>
        )}

        {(phase === "timeline" || (reduced && phase === "timeline")) && (
          <div className="preview-timeline">
            <div className="preview-meta">INCIDENT TIMELINE</div>
            <ul>
              {TIMELINE.map((row, idx) => (
                <li key={row.t} className={idx < step || reduced ? "show" : ""}>
                  <time>{row.t}</time>
                  <span>{row.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === "resolved" && (
          <div className="preview-resolved">
            <strong>INCIDENT RESOLVED</strong>
            <p>All clear · services healthy</p>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseLabel(phase: Phase) {
  if (phase === "healthy") return "STABLE";
  if (phase === "incident") return "DETECTED";
  if (phase === "timeline") return "INVESTIGATING";
  return "RESOLVED";
}
