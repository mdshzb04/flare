export const FLARE_SERVICES = [
  { id: "frontend", label: "frontend", role: "SPA" },
  { id: "api", label: "api", role: "HTTP + WS" },
  { id: "worker", label: "worker", role: "jobs" },
  { id: "db", label: "db", role: "Postgres" },
  { id: "redis", label: "redis", role: "Valkey" },
  { id: "storage", label: "storage", role: "S3" },
] as const;

export type ServiceId = (typeof FLARE_SERVICES)[number]["id"];

type Props = {
  affected: string[];
  onToggle?: (id: string) => void;
  interactive?: boolean;
  compact?: boolean;
  title?: string;
};

export function BlastMap({
  affected,
  onToggle,
  interactive = false,
  compact = false,
  title = "Blast radius",
}: Props) {
  const set = new Set(affected);

  return (
    <div className={`blast ${compact ? "blast-compact" : ""}`}>
      <div className="blast-head">
        <h3>{title}</h3>
        {interactive ? (
          <span className="muted">Click a service to mark impact</span>
        ) : (
          <span className="muted">Live across every open tab</span>
        )}
      </div>
      <div className="blast-grid" role="list">
        {FLARE_SERVICES.map((s) => {
          const hit = set.has(s.id);
          const Tag = interactive ? "button" : "div";
          return (
            <Tag
              key={s.id}
              type={interactive ? "button" : undefined}
              role="listitem"
              className={`blast-node ${hit ? "hit" : ""}`}
              onClick={interactive && onToggle ? () => onToggle(s.id) : undefined}
              aria-pressed={interactive ? hit : undefined}
            >
              {hit ? <span className="blast-ring" aria-hidden /> : null}
              {hit ? <span className="blast-ring delay" aria-hidden /> : null}
              <strong>{s.label}</strong>
              <span>{s.role}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
