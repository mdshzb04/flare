import { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { EventItem, Room } from "../api";
import { findUrlCheck, listUrlCheckHistory, parseUrlCheckNote, urlCheckEvents, displaySiteName, type ParsedUrlCheck } from "../lib/urlCheckNote";

type Props = {
  room: Room;
  code: string;
  name: string;
  connected: boolean;
  presence: string[];
  note: string;
  setNote: (v: string) => void;
  onSendNote: (e: FormEvent) => void;
  shareUrl: string;
};

function statusLine(check: ParsedUrlCheck) {
  if (check.isUp) return `Live — ${check.statusCode} OK, ${check.latencyMs}ms`;
  if (check.reason === "timed_out" || check.reason === "timed out") {
    return `Down — timed out (${check.latencyMs}ms)`;
  }
  if (check.statusCode && check.statusCode !== "—") return `Down — ${check.statusCode} (${check.latencyMs}ms)`;
  return `Down — ${check.reason?.replace(/_/g, " ") || "unreachable"}`;
}

export function UrlCheckRoomView({
  room,
  code,
  name,
  connected,
  presence,
  note,
  setNote,
  onSendNote,
  shareUrl,
}: Props) {
  const events = urlCheckEvents(room.events);
  const check = findUrlCheck(room.events);
  const history = listUrlCheckHistory(room.events);
  const notes = events.filter((ev) => !parseUrlCheckNote(ev.body));
  const siteName = check ? displaySiteName(check.url) : displaySiteName(room.title);
  const viewers = Math.max(presence.length, 1);

  return (
    <div className="shell product-shell url-check-room">
      <div className="topbar">
        <div>
          <p className="muted" style={{ margin: "0 0 0.35rem" }}>
            <Link to="/">Home</Link> · <Link to="/dashboard">Dashboard</Link> · URL check room
          </p>
          <h1 className="url-check-room-title">{siteName}</h1>
          <p className="muted url-check-room-host" style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>
            {check ? (
              <a href={check.url} target="_blank" rel="noreferrer">
                {check.url}
              </a>
            ) : (
              room.title
            )}
          </p>
        </div>
        <div className="row">
          <span className="muted">
            <i className={`live-dot ${connected ? "" : "bad"}`} />
            {connected ? "live" : "reconnecting"}
          </span>
          <span className="viewers">{viewers} viewing</span>
          <button type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>
            Copy link
          </button>
        </div>
      </div>

      {check ? (
        <div className={`card url-check-room-result ${check.isUp ? "up" : "down"}`}>
          <p className="url-check-room-kicker">Latest probe</p>
          <strong className="url-check-room-status">{statusLine(check)}</strong>
          {check.checkedAt ? (
            <span className="muted url-check-room-meta">Checked {new Date(check.checkedAt).toLocaleString()}</span>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No probe details in this room yet. Run a check from the landing page.
          </p>
        </div>
      )}

      <div className="split-2">
        <section className="card">
          <h3>Check history</h3>
          {history.length === 0 ? (
            <p className="muted">No probes recorded yet.</p>
          ) : (
            <ul className="url-check-history">
              {history.map((h, i) => (
                <li key={`${h.checkedAt || i}-${h.statusCode}`} className={h.isUp ? "up" : "down"}>
                  <strong>{statusLine(h)}</strong>
                  {h.checkedAt ? (
                    <span className="muted">{new Date(h.checkedAt).toLocaleString()}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Notes</h3>
          {notes.length === 0 ? (
            <p className="muted">No manual notes yet.</p>
          ) : (
            notes.map((ev: EventItem) => (
              <article key={ev.id} className="event">
                <div className="meta">
                  {ev.author} · {new Date(ev.createdAt).toLocaleString()}
                </div>
                <div className="url-check-note-body">{ev.body}</div>
              </article>
            ))
          )}
          <form className="composer" onSubmit={onSendNote}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this URL…"
              maxLength={4000}
            />
            <button className="primary" type="submit" disabled={!note.trim()}>
              Send
            </button>
          </form>
        </section>

        <aside className="side">
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Room</h3>
            <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
              Code <span className="mono">{code}</span>
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Signed in as <strong>{name}</strong>
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Participants</h3>
            <ul className="presence" style={{ paddingLeft: "1.1rem", margin: 0 }}>
              {presence.length === 0 ? <li className="muted">waiting…</li> : null}
              {presence.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Need full incident UI?</h3>
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
              Start a new incident room to see the full blast radius and cascade view.
            </p>
            <Link className="buttonish" to="/dashboard">
              Open dashboard
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
