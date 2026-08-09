import { FormEvent, useState } from "react";
import type { Investigation } from "../api";
import { askIncident } from "../api";

type Props = { code: string; report: Investigation | null };

export function InvestigatorPanel({ code, report }: Props) {
  const [q, setQ] = useState("Why did this incident happen?");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await askIncident(code, q);
      setAnswer(res.answer);
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "ask failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="investigator">
      <h3>Ask the incident</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.78rem" }}>
        Evidence-only investigator — no external LLM. Will say insufficient when data is thin.
      </p>
      {report ? (
        <div className="rca-box">
          <div className="muted">LIKELY ROOT CAUSE</div>
          <strong>
            {report.insufficient || !report.likelyRootCause
              ? "Insufficient evidence to determine the root cause."
              : report.likelyRootCause}
          </strong>
          {!report.insufficient ? (
            <div className="muted" style={{ marginTop: "0.35rem" }}>
              Confidence {report.confidence}%
            </div>
          ) : null}
          {report.evidence.length ? (
            <ol>
              {report.evidence.map((e) => (
                <li key={e.id}>{e.text}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      <form className="ask-form" onSubmit={(e) => void onAsk(e)}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} />
        <button className="primary" type="submit" disabled={busy || !q.trim()}>
          Ask
        </button>
      </form>
      {answer ? <p className="ask-answer">{answer}</p> : null}
    </div>
  );
}
