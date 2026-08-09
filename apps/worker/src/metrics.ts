/** Per-room load sim. Timers produce real ticking numbers; spikes follow affected[]. */

export type RoomSim = {
  affected: string[];
  /** Last presence / room:update — used for TTL, not tick time. */
  lastActivity: number;
  latencyMs: number;
  errorRate: number;
  queueDepth: number;
  reqCount: number;
};

export type MetricsPayload = {
  type: "metrics";
  ts: number;
  rps: number;
  latencyMs: number;
  errorRate: number;
  queueDepth: number;
  degradedPct: number;
  reqTotal: number;
  source: "demo";
};

const WEIGHTS: Record<string, number> = {
  frontend: 0.3,
  api: 1.0,
  worker: 0.6,
  db: 0.9,
  redis: 0.8,
  storage: 0.5,
};

// ponytail: 15m idle drop; shorten if worker RAM ever matters with abandoned rooms
export const ROOM_TTL_MS = 15 * 60 * 1000;
export const TICK_MS = 1000;
export const TOTAL_SERVICES = 6;

export function newRoomSim(affected: string[] = [], now = Date.now()): RoomSim {
  return {
    affected,
    lastActivity: now,
    latencyMs: 55,
    errorRate: 0.4,
    queueDepth: 2,
    reqCount: 0,
  };
}

export function stress(affected: string[]): number {
  let s = 0;
  for (const id of affected) s += WEIGHTS[id] ?? 0.4;
  return Math.min(s, 3);
}

export function degradedPct(
  affectedCount: number,
  errorRate: number,
  latencyMs: number,
  queueDepth: number,
): number {
  const affectedFrac = affectedCount / TOTAL_SERVICES;
  const latencyNorm = Math.min(latencyMs / 500, 1) * 100;
  const queueNorm = Math.min(queueDepth / 80, 1) * 100;
  return Math.round(
    Math.min(
      100,
      0.35 * affectedFrac * 100 + 0.35 * errorRate + 0.2 * latencyNorm + 0.1 * queueNorm,
    ),
  );
}

/** Advance sim one second. Mutates sim. */
export function tickRoom(sim: RoomSim, now = Date.now(), rand = Math.random): MetricsPayload {
  const s = stress(sim.affected);
  const rps = (12 + rand() * 8) * (1 + s * 0.4);
  const requests = Math.max(1, Math.round(rps));
  sim.reqCount += requests;

  const targetLat = 50 + s * 180 + rand() * 20;
  const targetErr = 0.3 + s * 12 + rand() * 1.5;
  const targetQ = 1 + s * 25 + rand() * 3;

  sim.latencyMs = sim.latencyMs * 0.7 + targetLat * 0.3;
  sim.errorRate = sim.errorRate * 0.7 + targetErr * 0.3;
  sim.queueDepth = sim.queueDepth * 0.6 + targetQ * 0.4;

  return {
    type: "metrics",
    ts: now,
    rps: Math.round(rps * 10) / 10,
    latencyMs: Math.round(sim.latencyMs),
    errorRate: Math.round(sim.errorRate * 10) / 10,
    queueDepth: Math.round(sim.queueDepth),
    degradedPct: degradedPct(sim.affected.length, sim.errorRate, sim.latencyMs, sim.queueDepth),
    reqTotal: sim.reqCount,
    source: "demo",
  };
}
