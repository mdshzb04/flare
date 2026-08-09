import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  EventItem,
  Investigation,
  Room,
  Severity,
  Status,
  TimelineEvent,
  eventPath,
  getIncident,
  getRoom,
  incidentAction,
  patchRoomHttp,
  postEvent,
  uploadFile,
  wsUrl,
} from "../api";
import { BlastMap, type LiveMetrics } from "../components/BlastMap";
import { InvestigatorPanel } from "../components/InvestigatorPanel";
import { Timeline } from "../components/Timeline";
import { HOP_MS, cascadeFrom, resolveOrder, sleep } from "../lib/deps";

const NAME_KEY = "flare:name";
const LAST_ROOM_KEY = "flare:lastRoom";
const ROLE_KEY = "flare:role";

type Role = "host" | "teammate";

function normalizeRoom(r: Room): Room {
  return {
    ...r,
    affected: r.affected ?? [],
    blastRoot: r.blastRoot ?? null,
  };
}

export function RoomPage() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [role, setRole] = useState<Role>(() =>
    localStorage.getItem(ROLE_KEY) === "teammate" ? "teammate" : "host",
  );
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [presence, setPresence] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [connected, setConnected] = useState(false);
  const [flashSev, setFlashSev] = useState(false);
  const [flashStatus, setFlashStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [report, setReport] = useState<Investigation | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevSev = useRef<string | null>(null);
  const prevStatus = useRef<string | null>(null);
  const cascading = useRef(false);
  const demoStarted = useRef(false);

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
        if (!dead) setRoom(normalizeRoom(r));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));
    getIncident(code)
      .then((d) => {
        if (dead) return;
        setTimeline(d.timeline);
        setReport(d.investigation);
      })
      .catch(() => {});

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
          event?: EventItem | TimelineEvent;
          eventId?: string;
          thumbUrl?: string;
          room?: Room;
          text?: string;
          rps?: number;
          latencyMs?: number;
          errorRate?: number;
          queueDepth?: number;
          degradedPct?: number;
          reqTotal?: number;
          ts?: number;
        };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "presence" && msg.names) setPresence(msg.names);
        if (msg.type === "activity" && msg.text) {
          setActivity((prev) => [msg.text!, ...prev].slice(0, 40));
        }
        if (msg.type === "timeline:append" && msg.event && "summary" in msg.event) {
          const te = msg.event as TimelineEvent;
          setTimeline((prev) => (prev.some((t) => t.id === te.id) ? prev : [...prev, te]));
          void getIncident(code)
            .then((d) => setReport(d.investigation))
            .catch(() => {});
        }
        if (
          msg.type === "metrics" &&
          typeof msg.latencyMs === "number" &&
          typeof msg.errorRate === "number" &&
          typeof msg.queueDepth === "number" &&
          typeof msg.degradedPct === "number" &&
          typeof msg.rps === "number" &&
          typeof msg.reqTotal === "number" &&
          typeof msg.ts === "number"
        ) {
          setMetrics({
            rps: msg.rps,
            latencyMs: msg.latencyMs,
            errorRate: msg.errorRate,
            queueDepth: msg.queueDepth,
            degradedPct: msg.degradedPct,
            reqTotal: msg.reqTotal,
            ts: msg.ts,
          });
        }
        if (msg.type === "event:create" && msg.event && "body" in msg.event) {
          const noteEv = msg.event as EventItem;
          setRoom((prev) => {
            if (!prev) return prev;
            if (prev.events.some((e) => e.id === noteEv.id)) return prev;
            return { ...prev, events: [...prev.events, noteEv] };
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
        if (msg.type === "room:update" && msg.room && !cascading.current) {
          setRoom(normalizeRoom(msg.room));
          setLocalCount(null);
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

  useEffect(() => {
    if (!joined || !room || demoStarted.current || params.get("demo") !== "1") return;
    if ((room.affected ?? []).length > 0) return;
    demoStarted.current = true;
    void runCascade("api");
  }, [joined, room?.id, params]);

  function join(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().slice(0, 64);
    if (!n) return;
    localStorage.setItem(NAME_KEY, n);
    localStorage.setItem(ROLE_KEY, role);
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
    patch: Partial<Pick<Room, "title" | "severity" | "status" | "assignee" | "affected" | "blastRoot">>,
  ) {
    if (!code) return normalizeRoom(room!);
    setRoom((prev) => (prev ? normalizeRoom({ ...prev, ...patch }) : prev));
    const updated = await patchRoomHttp(code, patch);
    const norm = normalizeRoom(updated);
    setRoom(norm);
    return norm;
  }

  async function runCascade(root: string) {
    if (!code || cascading.current) return;
    const hops = cascadeFrom(root);
    if (hops.length === 0) return;
    cascading.current = true;
    setBusy(true);
    try {
      let built: string[] = [];
      for (const hop of hops) {
        built = [...built, hop];
        setLocalCount(built.length);
        setRoom((prev) =>
          prev ? normalizeRoom({ ...prev, affected: built, blastRoot: root }) : prev,
        );
        await patchRoomHttp(code, { affected: built, blastRoot: root });
        await sleep(HOP_MS);
      }
      const final = await getRoom(code);
      setRoom(normalizeRoom(final));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "cascade failed");
    } finally {
      cascading.current = false;
      setBusy(false);
      setLocalCount(null);
    }
  }

  async function runResolve() {
    if (!code || !room || cascading.current) return;
    const order = resolveOrder(room.affected ?? []);
    if (order.length === 0) return;
    cascading.current = true;
    setBusy(true);
    try {
      let left = [...(room.affected ?? [])];
      for (const hop of order) {
        left = left.filter((id) => id !== hop);
        setLocalCount(left.length);
        setRoom((prev) =>
          prev
            ? normalizeRoom({
                ...prev,
                affected: left,
                blastRoot: left.length ? prev.blastRoot : null,
                status: left.length === 0 ? "resolved" : prev.status,
              })
            : prev,
        );
        await patchRoomHttp(code, {
          affected: left,
          blastRoot: left.length ? room.blastRoot : null,
          status: left.length === 0 ? "resolved" : room.status,
        });
        await sleep(HOP_MS);
      }
      const final = await getRoom(code);
      setRoom(normalizeRoom(final));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "resolve failed");
    } finally {
      cascading.current = false;
      setBusy(false);
      setLocalCount(null);
    }
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
        <label className="muted" htmlFor="role">
          Role
        </label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="host">Host / judge — full blast map</option>
          <option value="teammate">Teammate — focused checklist</option>
        </select>
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
  const affected = room.affected ?? [];

  if (role === "teammate") {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="row" style={{ marginBottom: "0.4rem" }}>
              <span className={`sev ${room.severity}`}>{room.severity}</span>
              <span className="muted">{room.status}</span>
              <span className="viewers">{viewers} viewing</span>
            </div>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>{room.title}</h2>
          </div>
          <button type="button" onClick={() => setRole("host")}>
            Switch to host view
          </button>
        </div>
        <div className="card glow" style={{ display: "grid", gap: "0.75rem" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
            {affected.length === 0 ? "Your services look clear" : "Your stack is in the blast radius"}
          </h3>
          {affected.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Stand by. Host will cascade impact when a service is marked down.
            </p>
          ) : (
            <ul className="stack-proof">
              {affected.map((id) => (
                <li key={id}>
                  <strong>{id}</strong> is impacted — check logs, pause deploys, confirm ownership
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            Live synced · {localCount ?? affected.length}/{6} services in radius
          </p>
        </div>
        <section className="card timeline">
          {room.events.map((ev) => (
            <article key={ev.id} className="event">
              <div className="meta">
                {ev.author} · {new Date(ev.createdAt).toLocaleTimeString()}
              </div>
              <div>{ev.body}</div>
            </article>
          ))}
        </section>
      </>
    );
  }

  return (
    <div className="shell product-shell">
      <div className="topbar">
        <div>
          <p className="muted" style={{ margin: "0 0 0.35rem" }}>
            <Link to="/">Dashboard</Link> · <Link to={`/incidents/${code}`}>Incident</Link> · war room
          </p>
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
          <button type="button" onClick={() => setRole("teammate")}>
            Teammate view
          </button>
        </div>
      </div>

      <div className="card glow" style={{ display: "grid", gap: "0.75rem" }}>
        <BlastMap
          affected={affected}
          blastRoot={room.blastRoot}
          interactive
          busy={busy}
          displayCount={localCount ?? undefined}
          metrics={metrics}
          onMarkDown={(id) => void runCascade(id)}
          title="Blast radius"
        />
        <div className="row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void incidentAction(code, "investigate", { author: name })}
          >
            Investigate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void incidentAction(code, "alert", { author: name })}
          >
            Send alert
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || affected.length === 0}
            onClick={() => void runResolve()}
          >
            Mark resolved — reverse cascade
          </button>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Demo: click <strong>api</strong> → watch hops → resolve
          </span>
        </div>
        {err ? <p style={{ color: "var(--sev1)", margin: 0 }}>{err}</p> : null}
      </div>

      <div className="split-2">
        <section className="card">
          <h3>Incident timeline</h3>
          <Timeline items={timeline} />
        </section>
        <section className="card">
          <InvestigatorPanel code={code} report={report} />
        </section>
      </div>

      <div className="layout">
        <section className="card timeline">
          <h3>Notes</h3>
          {room.events.length === 0 ? (
            <p className="muted">No updates yet.</p>
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
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Participants</h3>
            <ul className="presence" style={{ paddingLeft: "1.1rem", margin: 0 }}>
              {presence.length === 0 ? <li className="muted">waiting…</li> : null}
              {presence.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Activity</h3>
            <ul className="svc-list">
              {activity.length === 0 ? <li className="muted">—</li> : null}
              {activity.map((a, i) => (
                <li key={`${a}-${i}`}>{a}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
