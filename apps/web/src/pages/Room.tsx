import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  EventItem,
  Room,
  Severity,
  Status,
  getRoom,
  uploadFile,
  wsUrl,
} from "../api";

const NAME_KEY = "flare:name";

export function RoomPage() {
  const { code = "" } = useParams();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [presence, setPresence] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shareUrl = useMemo(() => (code ? `${location.origin}/r/${code}` : ""), [code]);

  useEffect(() => {
    if (!joined || !code || !name) return;
    let dead = false;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    getRoom(code)
      .then((r) => {
        if (!dead) setRoom(r);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));

    const ws = new WebSocket(wsUrl(code, name));
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      let msg: {
        type?: string;
        names?: string[];
        event?: EventItem;
        eventId?: string;
        thumbUrl?: string;
        room?: Room;
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "presence" && msg.names) setPresence(msg.names);
      if (msg.type === "event:create" && msg.event) {
        setRoom((prev) => (prev ? { ...prev, events: [...prev.events, msg.event!] } : prev));
      }
      if (msg.type === "event:thumb" && msg.eventId && msg.thumbUrl) {
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                events: prev.events.map((e) =>
                  e.id === msg.eventId ? { ...e, thumbUrl: msg.thumbUrl! } : e,
                ),
              }
            : prev,
        );
      }
      if (msg.type === "room:update" && msg.room) setRoom(msg.room);
    };

    return () => {
      dead = true;
      if (pingTimer) clearInterval(pingTimer);
      ws.close();
      wsRef.current = null;
    };
  }, [joined, code, name]);

  function join(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().slice(0, 64);
    if (!n) return;
    localStorage.setItem(NAME_KEY, n);
    setName(n);
    setJoined(true);
  }

  function sendNote(e: FormEvent) {
    e.preventDefault();
    const body = note.trim();
    if (!body || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "event:create", body }));
    setNote("");
  }

  function patchRoom(patch: Partial<Pick<Room, "title" | "severity" | "status" | "assignee">>) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "room:update", ...patch }));
  }

  async function onUpload(file: File) {
    if (!code) return;
    try {
      await uploadFile(code, file, name, `Screenshot: ${file.name}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "upload failed");
    }
  }

  if (!joined) {
    return (
      <form className="gate card" onSubmit={join}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>Join room</h2>
        <p className="muted" style={{ margin: 0 }}>
          Code <span className="mono">{code}</span>
        </p>
        <input
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          autoFocus
        />
        <button className="primary" type="submit">
          Enter war-room
        </button>
      </form>
    );
  }

  if (!room) {
    return <p className="muted">{err || "Loading room…"}</p>;
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="row" style={{ marginBottom: "0.4rem" }}>
            <span className={`sev ${room.severity}`}>{room.severity}</span>
            <span className="muted">{room.status}</span>
            <span className="muted">
              <i className="live-dot" />
              {connected ? "live" : "reconnecting"}
            </span>
          </div>
          <input
            value={room.title}
            onChange={(e) => setRoom({ ...room, title: e.target.value })}
            onBlur={(e) => patchRoom({ title: e.target.value })}
            style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", fontWeight: 700 }}
          />
          <p className="muted" style={{ margin: "0.4rem 0 0" }}>
            Share <button type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>copy link</button>
          </p>
        </div>
        <div className="row">
          <select
            value={room.severity}
            onChange={(e) => patchRoom({ severity: e.target.value as Severity })}
            aria-label="Severity"
          >
            <option value="sev1">sev1</option>
            <option value="sev2">sev2</option>
            <option value="sev3">sev3</option>
            <option value="sev4">sev4</option>
          </select>
          <select
            value={room.status}
            onChange={(e) => patchRoom({ status: e.target.value as Status })}
            aria-label="Status"
          >
            <option value="investigating">investigating</option>
            <option value="identified">identified</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
          </select>
        </div>
      </div>

      <div className="layout">
        <section className="card timeline">
          {room.events.length === 0 ? (
            <p className="muted">No updates yet. First note sets the timeline.</p>
          ) : (
            room.events.map((ev) => (
              <article key={ev.id} className="event">
                <div className="meta">
                  {ev.author} · {new Date(ev.createdAt).toLocaleTimeString()} · {ev.kind}
                </div>
                <div>{ev.body}</div>
                {ev.thumbUrl || ev.attachmentUrl ? (
                  <img src={ev.thumbUrl || ev.attachmentUrl || ""} alt="attachment" />
                ) : null}
              </article>
            ))
          )}

          <form className="composer" onSubmit={sendNote}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Post an update…"
              maxLength={4000}
            />
            <div className="row">
              <button className="primary" type="submit" disabled={!note.trim()}>
                Send
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}>
                Upload screenshot
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = "";
                }}
              />
            </div>
            {err ? <p style={{ color: "var(--sev1)", margin: 0 }}>{err}</p> : null}
          </form>
        </section>

        <aside className="side">
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Assignee</h3>
            <input
              value={room.assignee}
              placeholder="Who owns this?"
              onChange={(e) => setRoom({ ...room, assignee: e.target.value })}
              onBlur={(e) => patchRoom({ assignee: e.target.value })}
            />
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>On call</h3>
            <ul className="presence" style={{ paddingLeft: "1.1rem", margin: 0 }}>
              {presence.length === 0 ? <li className="muted">waiting…</li> : null}
              {presence.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
