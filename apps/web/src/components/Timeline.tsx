import type { TimelineEvent } from "../api";

type Props = { items: TimelineEvent[] };

export function Timeline({ items }: Props) {
  if (!items.length) {
    return <p className="muted">No timeline events yet — degrade a service or ingest telemetry.</p>;
  }
  return (
    <ol className="timeline-list">
      {items.map((ev) => (
        <li key={ev.id}>
          <time>{new Date(ev.createdAt).toLocaleTimeString()}</time>
          <div>
            <strong className="mono">{ev.kind}</strong>
            <div>{ev.summary}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
