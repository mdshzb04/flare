import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Room, getRoom } from "../api";

export function StatusPage() {
  const { code = "" } = useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!code) return;
    let dead = false;
    function load() {
      getRoom(code)
        .then((r) => {
          if (!dead) setRoom(r);
        })
        .catch((e) => {
          if (!dead) setErr(e instanceof Error ? e.message : "failed");
        });
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [code]);

  if (err) return <p style={{ color: "var(--sev1)" }}>{err}</p>;
  if (!room) return <p className="muted">Loading status…</p>;

  return (
    <section className="status-hero">
      <div className="eyebrow">Public status · read-only · refreshes 5s</div>
      <div className="row">
        <span className={`sev ${room.severity}`}>{room.severity}</span>
        <span className="muted">{room.status}</span>
      </div>
      <h1>{room.title}</h1>
      <p className="muted" style={{ margin: 0 }}>
        Assignee: {room.assignee || "unassigned"} · {room.events.length} updates
      </p>
      <div className="card timeline" style={{ minHeight: 0 }}>
        {room.events.length === 0 ? (
          <p className="muted">No public updates yet.</p>
        ) : (
          room.events
            .slice()
            .reverse()
            .map((ev) => (
              <article key={ev.id} className="event">
                <div className="meta">
                  {ev.author} · {new Date(ev.createdAt).toLocaleString()}
                </div>
                <div>{ev.body}</div>
              </article>
            ))
        )}
      </div>
      <p className="muted">
        Responders: join the <Link to={`/r/${code}`}>war-room</Link>
      </p>
    </section>
  );
}
