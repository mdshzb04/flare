export const FLARE_SERVICES = [
  { id: "frontend", label: "frontend", role: "SPA" },
  { id: "api", label: "api", role: "HTTP + WS" },
  { id: "worker", label: "worker", role: "jobs" },
  { id: "db", label: "db", role: "Postgres" },
  { id: "redis", label: "redis", role: "Valkey" },
  { id: "storage", label: "storage", role: "S3" },
] as const;

export type ServiceId = (typeof FLARE_SERVICES)[number]["id"];
