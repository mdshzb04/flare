const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type Status = "investigating" | "identified" | "monitoring" | "resolved";

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
  createdAt: string;
  updatedAt: string;
  events: EventItem[];
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

export function createRoom(title: string) {
  return req<{ code: string; urlPath: string }>("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function getRoom(code: string) {
  return req<Room>(`/api/rooms/${code}`);
}

export function patchRoomHttp(
  code: string,
  patch: Partial<Pick<Room, "title" | "severity" | "status" | "assignee">>,
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
