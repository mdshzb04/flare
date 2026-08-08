import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom } from "../api";

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
      <div className="eyebrow">Zerops · 6 services · live</div>
      <div className="hero-grid">
        <div style={{ display: "grid", gap: "1.1rem" }}>
          <h1>Flare</h1>
          <p className="lede">
            Incident war-room for when infra burns. Share one link — severity, timeline, and
            presence sync across the team. Built as a real multi-service stack on Zerops, not a
            single-box demo.
          </p>
          <div className="pill-row">
            <span className="pill">frontend</span>
            <span className="pill">api + websocket</span>
            <span className="pill">worker</span>
            <span className="pill">postgres</span>
            <span className="pill">valkey</span>
            <span className="pill">object storage</span>
          </div>
          <ul className="stack-proof">
            <li>Notes persist in Postgres</li>
            <li>Live sync fans out over Valkey pub/sub</li>
            <li>Screenshots hit object storage + worker thumbnails</li>
          </ul>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            Judges: open <Link to="/architecture">Architecture</Link> for live health checks.
          </p>
        </div>

        <form className="card glow" onSubmit={onSubmit} style={{ display: "grid", gap: "0.85rem" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: "0.5rem" }}>
              Open a room
            </div>
            <label className="muted" htmlFor="title">
              Incident title
            </label>
          </div>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <div className="row">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Opening…" : "Open war-room"}
            </button>
          </div>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            No login. Link is the key. Public status page at /s/:code after create.
          </span>
          {err ? <p style={{ color: "var(--sev1)", margin: 0 }}>{err}</p> : null}
        </form>
      </div>
    </section>
  );
}
