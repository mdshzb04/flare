import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
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
      <h1>Live incident war-room</h1>
      <p>
        Open a room, share the link, sync severity and timeline across tabs. Built on Zerops:
        frontend, API, worker, Postgres, Valkey, object storage.
      </p>
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: 520, display: "grid", gap: "0.75rem" }}>
        <label className="muted" htmlFor="title">
          Incident title
        </label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open war-room"}
          </button>
          <span className="muted">No login — link is the key</span>
        </div>
        {err ? <p style={{ color: "var(--sev1)", margin: 0 }}>{err}</p> : null}
      </form>
    </section>
  );
}
