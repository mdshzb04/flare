import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FLARE_SERVICES, type ServiceId } from "../lib/services";
import { cascadeFrom, impactStats, isServiceId } from "../lib/deps";

export { FLARE_SERVICES };
export type { ServiceId };

type Props = {
  affected: string[];
  blastRoot?: string | null;
  onMarkDown?: (id: string) => void;
  interactive?: boolean;
  compact?: boolean;
  title?: string;
  busy?: boolean;
  showCounter?: boolean;
  displayCount?: number;
};

export function BlastMap({
  affected,
  blastRoot = null,
  onMarkDown,
  interactive = false,
  compact = false,
  title = "Blast radius",
  busy = false,
  showCounter = true,
  displayCount,
}: Props) {
  const set = new Set(affected);
  const hopIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (blastRoot && isServiceId(blastRoot)) {
      cascadeFrom(blastRoot).forEach((id, i) => map.set(id, i));
    } else {
      affected.forEach((id, i) => map.set(id, i));
    }
    return map;
  }, [affected, blastRoot]);

  const prevRef = useRef<string[]>([]);
  const [justHit, setJustHit] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = new Set(prevRef.current);
    const added = affected.filter((id) => !prev.has(id));
    prevRef.current = affected;
    if (added.length) {
      setJustHit(new Set(added));
      const t = setTimeout(() => setJustHit(new Set()), 900);
      return () => clearTimeout(t);
    }
  }, [affected]);

  const count = displayCount ?? affected.length;
  const stats = impactStats(count);

  return (
    <div className={`blast ${compact ? "blast-compact" : ""} ${busy ? "blast-busy" : ""}`}>
      <div className="blast-head">
        <h3>{title}</h3>
        {interactive ? (
          <span className="muted">{busy ? "Cascade running…" : "Click a service to start blast"}</span>
        ) : (
          <span className="muted">Live across every open tab</span>
        )}
      </div>

      {showCounter ? (
        <div className="impact-counter" aria-live="polite">
          <strong>{stats.count}</strong>
          <span>/{stats.total} services</span>
          <em>~{stats.pct}% stack degraded</em>
        </div>
      ) : null}

      <div className="blast-grid" role="list">
        {FLARE_SERVICES.map((s) => {
          const hit = set.has(s.id);
          const hop = hopIndex.get(s.id) ?? 0;
          const style = hit ? ({ ["--hop"]: hop } as CSSProperties) : undefined;
          const Tag = interactive ? "button" : "div";
          return (
            <Tag
              key={s.id}
              type={interactive ? "button" : undefined}
              role="listitem"
              disabled={interactive ? busy : undefined}
              className={`blast-node ${hit ? "hit" : "ok"} ${justHit.has(s.id) ? "just-hit" : ""}`}
              style={style}
              onClick={interactive && onMarkDown && !busy ? () => onMarkDown(s.id) : undefined}
              aria-pressed={interactive ? hit : undefined}
            >
              {hit ? <span className="blast-ring" aria-hidden /> : null}
              {hit ? <span className="blast-ring delay" aria-hidden /> : null}
              <strong>{s.label}</strong>
              <span>{hit ? "impacted" : s.role}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
