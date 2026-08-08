import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  EventItem,
  Room,
  Severity,
  Status,
  eventPath,
  getRoom,
  patchRoomHttp,
  postEvent,
  uploadFile,
  wsUrl,
} from "../api";
import { BlastMap } from "../components/BlastMap";

const NAME_KEY = "flare:name";
const LAST_ROOM_KEY = "flare:lastRoom";

export function RoomPage() {
  const { code = "" } = useParams();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [presence, setPresence] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [connected, setConnected] = useState(false);
  const [flashSev, setFlashSev] = useState(false);
  const [flashStatus, setFlashStatus] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevSev = useRef<string | null>(null);
  const prevStatus = useRef<string | null>(null);

  const shareUrl = useMemo(() => (code ? `${location.origin}/r/${code}` : ""), [code]);

  useEffect(() => {
    if (code) localStorage.setItem(LAST_ROOM_KEY, code);
  }, [code]);

  useEffect(() => {
    if (!room) return;
    if (prevSev.current && prevSev.current !== room.severity) {
      setFlashSev(true);
      const t = setTimeout(() => setFlashSev(false), 600);
      prevSev.current = room.severity;
      return () => clearTimeout(t);
    }
    prevSev.current = room.severity;
  }, [room?.severity]);

  useEffect(() => {
    if (!room) return;
    if (prevStatus.current && prevStatus.current !== room.status) {
      setFlashStatus(true);
      const t = setTimeout(() => setFlashStatus(false), 600);
      prevStatus.current = room.status;
      return () => clearTimeout(t);
    }
    prevStatus.current = room.status;
  }, [room?.status]);

  useEffect(() => {
    if (!joined || !code || !name) return;
    let dead = false;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    getRoom(code)
      .then((r) => {
        if (!dead) setRoom({ ...r, affected: r.affected ?? [] });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));

    function connect() {
      if (dead) return;
      ws = new WebSocket(wsUrl(code, name));
      wsRef.current = ws;

      ws.onopen = () => {
        if (dead) return;
        setConnected(true);
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 20000);
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimer) clearInterval(pingTimer);
        if (!dead) retryTimer = setTimeout(connect, 1500);
      };

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
          setRoom((prev) => {
            if (!prev) return prev;
            if (prev.events.some((e) => e.id === msg.event!.id)) return prev;
            return { ...prev, events: [...prev.events, msg.event!] };
          });
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
        if (msg.type === "room:update" && msg.room) {
          setRoom({ ...msg.room, affected: msg.room.affected ?? [] });
        }
      };
    }

    connect();

    return () => {
      dead = true;
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
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

  async function sendNote(e: FormEvent) {
    e.preventDefault();
    const body = note.trim();
    if (!body || !code) return;
    setNote("");
    try {
      const event = await postEvent(code, body, name);
      setRoom((prev) =>
        prev && !prev.events.some((x) => x.id === event.id)
          ? { ...prev, events: [...prev.events, event] }
          : prev,
      );
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "send failed");
      setNote(body);
    }
  }

  async function patchRoom(
    patch: Partial<Pick<Room, "title" | "severity" | "status" | "assignee" | "affected">>,
  ) {
    if (!code) return;
    setRoom((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      const updated = await patchRoomHttp(code, patch);
      setRoom({ ...updated, affected: updated.affected ?? [] });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "update failed");
      try {
        const r = await getRoom(code);
        setRoom({ ...r, affected: r.affected ?? [] });
      } catch {
        /* */
      }
    }
  }

  function toggleAffected(serviceId: string) {
    if (!room) return;
    const cur = new Set(room.affected ?? []);
    if (cur.has(serviceId)) cur.delete(serviceId);
    else cur.add(serviceId);
    void patchRoom({ affected: [...cur] });
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

  const viewers = Math.max(presence.length, 1);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="row" style={{ marginBottom: "0.4rem" }}>
            <span className={`sev ${room.severity} ${flashSev ? "flash" : ""}`}>{room.severity}</span>
            <span className={`muted ${flashStatus ? "flash" : ""}`}>{room.status}</span>
            <span className="muted">
              <i className={`live-dot ${connected ? "" : "bad"}`} />
              {connected ? "live" : "reconnecting"}
            </span>
            <span className="viewers" title={presence.join(", ") || name}>
              {viewers} {viewers === 1 ? "person" : "people"} viewing
            </span>
          </div>
          <input
            value={room.title}
            onChange={(e) => setRoom({ ...room, title: e.target.value })}
            onBlur={(e) => void patchRoom({ title: e.target.value })}
            style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", fontWeight: 700 }}
          />
          <p className="muted" style={{ margin: "0.4rem 0 0" }}>
            Share{" "}
            <button type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>
              copy link
            </button>{" "}
            · <Link to={`/s/${code}`}>public status</Link> ·{" "}
            <Link to={`/architecture?room=${code}`}>architecture</Link>
          </p>
        </div>
        <div className="row">
          <select
            className={flashSev ? "flash" : ""}
            value={room.severity}
            onChange={(e) => void patchRoom({ severity: e.target.value as Severity })}
            aria-label="Severity"
          >
            <option value="sev1">sev1</option>
            <option value="sev2">sev2</option>
            <option value="sev3">sev3</option>
            <option value="sev4">sev4</option>
          </select>
          <select
            className={flashStatus ? "flash" : ""}
            value={room.status}
            onChange={(e) => void patchRoom({ status: e.target.value as Status })}
            aria-label="Status"
          >
            <option value="investigating">investigating</option>
            <option value="identified">identified</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
          </select>
        </div>
      </div>

      <div className="card glow">
        <BlastMap
          affected={room.affected ?? []}
          interactive
          onToggle={toggleAffected}
          title="Blast radius"
        />
      </div>

      <div className="layout">
        <section className="card timeline">
          {room.events.length === 0 ? (
            <p className="muted">No updates yet. First note sets the timeline.</p>
          ) : (
            room.events.map((ev) => (
              <article key={ev.id} className="event">
                <div className="meta">
                  <span>
                    {ev.author} · {new Date(ev.createdAt).toLocaleTimeString()} · {ev.kind}
                  </span>
                </div>
                <div>{ev.body}</div>
                {ev.thumbUrl || ev.attachmentUrl ? (
                  <img src={ev.thumbUrl || ev.attachmentUrl || ""} alt="attachment" />
                ) : null}
                <div className="path">path: {eventPath(ev.kind)}</div>
              </article>
            ))
          )}

          <form className="composer" onSubmit={(e) => void sendNote(e)}>
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
              onBlur={(e) => void patchRoom({ assignee: e.target.value })}
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
