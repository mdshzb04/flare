const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type Status = "investigating" | "identified" | "monitoring" | "mitigating" | "resolved";

export type EventItem = {
  id: string;
  kind: string;
  body: string;
  author: string;
  attachmentUrl: string | null;
  thumbUrl: string | null;
  createdAt: string;
};

export type Room = {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  status: Status;
  assignee: string;
  affected: string[];
  blastRoot?: string | null;
  createdAt: string;
  updatedAt: string;
  events: EventItem[];
};

export type TimelineEvent = {
  id: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type Investigation = {
  likelyRootCause: string | null;
  confidence: number;
  evidence: { id: string; text: string }[];
  affectedServices: string[];
  recommendedNext: string[];
  insufficient: boolean;
};

export type ArchService = { name: string; role: string };

export type Health = {
  ok: boolean;
  service: string;
  checks: { postgres: boolean; valkey: boolean; storage: boolean };
  architecture: string[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export function createRoom(title: string, detectionSource = "manual") {
  return req<{ code: string; urlPath: string }>("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, detectionSource }),
  });
}

export function getRoom(code: string) {
  return req<Room>(`/api/rooms/${code}`);
}

export function patchRoomHttp(
  code: string,
  patch: Partial<Pick<Room, "title" | "severity" | "status" | "assignee" | "affected" | "blastRoot">>,
) {
  return req<Room>(`/api/rooms/${code}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function postEvent(code: string, body: string, author: string) {
  return req<EventItem>(`/api/rooms/${code}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, author, kind: "note" }),
  });
}

export function getArchitecture() {
  return req<{ name: string; platform: string; services: ArchService[] }>("/api/architecture");
}

export function getHealth() {
  return req<Health>("/health");
}

export function getDashboard() {
  return req<{
    mode: string;
    metrics: Record<string, unknown>;
    activeIncidents: {
      code: string;
      title: string;
      severity: string;
      severityLabel: string;
      status: string;
      affected: string[];
    }[];
    recentIncidents: { code: string; title: string; severity: string; status: string }[];
    services: { id: string; role: string; status: string }[];
    recentTimeline: { id: string; kind: string; summary: string; roomCode: string; createdAt: string }[];
    warRooms: { code: string; title: string }[];
  }>("/api/dashboard");
}

export function getServices() {
  return req<{
    services: {
      id: string;
      name: string;
      role: string;
      deps: string[];
      status: string;
      errorRate: number | null;
      latencyMs: number | null;
      queueDepth: number | null;
      rps: number | null;
      metricsSource: string | null;
      lastIncident: string | null;
    }[];
  }>("/api/services");
}

export function getService(id: string) {
  return req<{
    id: string;
    role: string;
    deps: string[];
    metrics: Record<string, unknown> | null;
    telemetry: { id: string; type: string; severity: string; message: string; createdAt: string }[];
    incidents: { code: string; title: string; status: string; severity: string }[];
  }>(`/api/services/${id}`);
}

export function getIncidents() {
  return req<{
    incidents: {
      code: string;
      title: string;
      severity: string;
      severityLabel: string;
      status: string;
      affected: string[];
      blastRoot: string | null;
      detectionSource: string;
      createdAt: string;
      updatedAt: string;
    }[];
  }>("/api/incidents");
}

export function getIncident(code: string) {
  return req<{
    incident: Room & { detectionSource?: string; severityLabel?: string };
    timeline: TimelineEvent[];
    investigation: Investigation;
    metrics: Record<string, unknown> | null;
  }>(`/api/incidents/${code}`);
}

export function incidentAction(code: string, action: string, extra?: { note?: string; author?: string }) {
  return req<{ ok: boolean; room: Room }>(`/api/incidents/${code}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
}

export function askIncident(code: string, question: string) {
  return req<{ answer: string; insufficient: boolean }>(`/api/incidents/${code}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

export function getIntegrations() {
  return req<{
    integrations: {
      id: string;
      kind: string;
      name: string;
      enabled: boolean;
      events: string[];
      urlMasked: string;
      hasUrl: boolean;
    }[];
  }>("/api/integrations");
}

export function putIntegration(body: {
  id?: string;
  kind: string;
  name?: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
}) {
  return req<{ integrations: unknown[] }>("/api/integrations", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getAutomationRules() {
  return req<{
    rules: {
      id: string;
      name: string;
      enabled: boolean;
      trigger: { metric: string; op: string; value: number };
      actions: string[];
    }[];
  }>("/api/automation/rules");
}

export function createAutomationRule(body: {
  name: string;
  enabled?: boolean;
  trigger: { metric: string; op: string; value: number };
  actions: string[];
}) {
  return req<{ id: string }>("/api/automation/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchAutomationRule(id: string, body: Partial<{ enabled: boolean; name: string }>) {
  return req<{ ok: boolean }>(`/api/automation/rules/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function uploadFile(code: string, file: File, author: string, body: string) {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("author", author);
  fd.set("body", body);
  return req<EventItem>(`/api/rooms/${code}/upload`, { method: "POST", body: fd });
}

export function wsUrl(code: string, name: string) {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) {
    const u = new URL(env);
    u.searchParams.set("room", code);
    u.searchParams.set("name", name);
    return u.toString();
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = API_URL ? new URL(API_URL).host : location.host;
  return `${proto}//${host}/ws?room=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
}

export function eventPath(kind: string) {
  if (kind === "attachment") {
    return "api → storage → Valkey queue → worker → Postgres → Valkey fan-out";
  }
  return "api → Postgres → Valkey pub/sub → other clients";
}
