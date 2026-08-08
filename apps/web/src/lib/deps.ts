import { FLARE_SERVICES, type ServiceId } from "./services";

export type { ServiceId };
export { FLARE_SERVICES };

/** Outgoing edges: failure at A spreads along A → dependency. */
export const SERVICE_DEPS: Record<ServiceId, ServiceId[]> = {
  frontend: ["api"],
  api: ["db", "redis", "storage"],
  worker: ["redis", "db", "storage", "api"],
  db: [],
  redis: [],
  storage: [],
};

export const HOP_MS = 500;

export function isServiceId(id: string): id is ServiceId {
  return FLARE_SERVICES.some((s) => s.id === id);
}

/** BFS cascade order from epicenter following SERVICE_DEPS. */
export function cascadeFrom(root: string): ServiceId[] {
  if (!isServiceId(root)) return [];
  const out: ServiceId[] = [];
  const seen = new Set<ServiceId>();
  const q: ServiceId[] = [root];
  while (q.length) {
    const n = q.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    for (const next of SERVICE_DEPS[n]) {
      if (!seen.has(next)) q.push(next);
    }
  }
  return out;
}

export function resolveOrder(affected: string[]): ServiceId[] {
  const set = new Set(affected.filter(isServiceId));
  if (set.size === 0) return [];
  let best: ServiceId[] = [];
  for (const id of FLARE_SERVICES.map((s) => s.id)) {
    if (!set.has(id)) continue;
    const path = cascadeFrom(id).filter((n) => set.has(n));
    if (path.length > best.length) best = path;
  }
  if (best.length === 0) best = [...set];
  return best.reverse();
}

export function impactStats(affectedCount: number) {
  const total = FLARE_SERVICES.length;
  const pct = Math.round((affectedCount / total) * 100);
  return { count: affectedCount, total, pct };
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
