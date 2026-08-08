import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom } from "../api";
import { BlastMap } from "../components/BlastMap";

export function Home() {
  const nav = useNavigate();
  const [title, setTitle] = useState("API latency spike — prod");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const room = await createRoom(title.trim() || "Untitled incident");
      nav(`/r/${room.code}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <div className="eyebrow">No login · no setup · live in seconds</div>
      <div className="hero-grid">
        <div style={{ display: "grid", gap: "1.1rem" }}>
          <h1>Flare</h1>
          <p className="lede">
            Get your team looking at the same incident, in seconds — no login, no setup. Share one
            link. Severity, timeline, and blast radius sync live across every browser.
          </p>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}>
            <input
              aria-label="Incident title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
            <div className="row">
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Opening…" : "Start a room"}
              </button>
              <Link className="muted" to="/architecture">
                See architecture
              </Link>
            </div>
            {err ? <p style={{ color: "var(--sev1)", margin: 0 }}>{err}</p> : null}
          </form>
        </div>

        <div className="card glow preview-card">
          <BlastMap
            affected={["api", "db"]}
            compact
            title="Blast radius preview"
          />
          <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.78rem" }}>
            Mark a service down in a room — every connected tab pulses red. That’s the demo moment.
          </p>
        </div>
      </div>
    </section>
  );
}
