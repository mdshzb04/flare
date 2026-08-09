/** Discord webhook payloads — presentation only. Delivery lives in integrations.ts. */

export type NotifyMetrics = {
  errorRate?: number | null;
  availability?: number | null;
  latencyMs?: number | null;
};

export type NotifyRoom = {
  title: string;
  severity: string;
  status: string;
  affected: string[];
  blastRoot?: string | null;
  metrics?: NotifyMetrics | null;
  previousSeverity?: string | null;
  startedAt?: string | Date | null;
  impact?: string | null;
  /** Shorter recovery style when blast radius clears */
  alertVariant?: "resolved" | "all_clear" | null;
};

export type DiscordAlertEvent =
  | "incident.created"
  | "incident.escalated"
  | "service.degraded"
  | "incident.resolved"
  | "test";

type EmbedField = { name: string; value: string; inline?: boolean };

type DiscordEmbed = {
  title: string;
  description?: string;
  color: number;
  fields: EmbedField[];
  timestamp: string;
  footer: { text: string };
};

const COLOR = {
  critical: 0xe74c3c,
  high: 0xe67e22,
  medium: 0xf1c40f,
  ok: 0x2ecc71,
  info: 0x5865f2,
  degraded: 0xe74c3c,
} as const;

export function discordWebhookUrl() {
  return (process.env.DISCORD_WEBHOOK_URL || "").trim();
}

export function publicRoomUrl(roomCode: string) {
  const base = (process.env.PUBLIC_APP_URL || "https://frontend-2b1c.prg1.zerops.app").replace(
    /\/$/,
    "",
  );
  // Never surface localhost in production alerts
  if (/localhost|127\.0\.0\.1/i.test(base) && process.env.NODE_ENV === "production") {
    return `https://frontend-2b1c.prg1.zerops.app/r/${roomCode}`;
  }
  return `${base}/r/${roomCode}`;
}

export function publicIncidentUrl(roomCode: string) {
  const base = (process.env.PUBLIC_APP_URL || "https://frontend-2b1c.prg1.zerops.app").replace(
    /\/$/,
    "",
  );
  if (/localhost|127\.0\.0\.1/i.test(base) && process.env.NODE_ENV === "production") {
    return `https://frontend-2b1c.prg1.zerops.app/incidents/${roomCode}`;
  }
  return `${base}/incidents/${roomCode}`;
}

function envLabel() {
  const raw = (
    process.env.FLARE_ENV ||
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
    process.env.ZEROPS_APP ||
    process.env.NODE_ENV ||
    "production"
  ).toLowerCase();
  if (raw.includes("prod") || raw === "zerops") return "Production";
  if (raw.includes("dev") || raw === "local" || raw === "development") return "Development";
  return raw.slice(0, 32);
}

function footerText() {
  return `Flare · Incident Response · ${envLabel()}`;
}

function sevLabel(severity: string) {
  const s = (severity || "").toLowerCase();
  if (s === "sev1" || s === "critical") return "CRITICAL";
  if (s === "sev2" || s === "high") return "HIGH";
  if (s === "sev3" || s === "medium") return "MEDIUM";
  if (s === "sev4" || s === "low") return "LOW";
  return (severity || "UNKNOWN").toUpperCase();
}

function statusLabel(status: string) {
  return (status || "unknown").replace(/_/g, " ").toUpperCase();
}

function sevColor(severity: string) {
  const label = sevLabel(severity);
  if (label === "CRITICAL") return COLOR.critical;
  if (label === "HIGH") return COLOR.high;
  if (label === "MEDIUM") return COLOR.medium;
  return COLOR.info;
}

function primaryService(room: NotifyRoom) {
  return room.blastRoot || room.affected[0] || null;
}

function codeBlock(value: string) {
  return `\`${value.slice(0, 64)}\``;
}

function evidenceFields(metrics?: NotifyMetrics | null): string[] {
  if (!metrics) return [];
  const lines: string[] = [];
  if (metrics.errorRate != null && Number.isFinite(metrics.errorRate)) {
    lines.push(`• Error rate: ${Number(metrics.errorRate).toFixed(1)}%`);
  }
  if (metrics.availability != null && Number.isFinite(metrics.availability)) {
    lines.push(`• Availability: ${(Number(metrics.availability) * 100).toFixed(1)}%`);
  }
  if (metrics.latencyMs != null && Number.isFinite(metrics.latencyMs)) {
    const ms = Number(metrics.latencyMs);
    lines.push(ms >= 1000 ? `• Latency: ${(ms / 1000).toFixed(1)}s` : `• Latency: ${Math.round(ms)}ms`);
  }
  return lines;
}

function formatDuration(startedAt?: string | Date | null): string | null {
  if (!startedAt) return null;
  const start = startedAt instanceof Date ? startedAt.getTime() : Date.parse(String(startedAt));
  if (!Number.isFinite(start)) return null;
  const sec = Math.max(0, Math.round((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function impactText(room: NotifyRoom): string | null {
  if (room.impact?.trim()) return room.impact.trim().slice(0, 200);
  const er = room.metrics?.errorRate;
  if (er != null && er >= 25) return "Elevated HTTP errors / error-rate threshold exceeded";
  if (er != null && er >= 8) return "Elevated error rate detected";
  const lat = room.metrics?.latencyMs;
  if (lat != null && lat >= 1500) return "Elevated latency detected";
  return null;
}

function warRoomField(roomCode: string): EmbedField {
  return { name: "War room", value: `[Open War Room](${publicRoomUrl(roomCode)})` };
}

function incidentField(roomCode: string): EmbedField {
  return { name: "Incident ID", value: codeBlock(roomCode), inline: true };
}

/** Legacy helper used by selfcheck / old callers. Prefer buildDiscordAlert. */
export function buildDiscordPayload(
  kind: "down" | "clear",
  roomCode: string,
  room: NotifyRoom,
) {
  return buildDiscordAlert(kind === "clear" ? "incident.resolved" : "incident.created", roomCode, room);
}

export function buildDiscordAlert(
  event: DiscordAlertEvent,
  roomCode: string,
  room: NotifyRoom,
): { content: string; embeds: DiscordEmbed[] } {
  const now = new Date().toISOString();
  const service = primaryService(room);
  const evidence = evidenceFields(room.metrics);
  const impact = impactText(room);
  const duration = formatDuration(room.startedAt);
  const title = (room.title || "Untitled incident").slice(0, 200);
  const critical = sevLabel(room.severity) === "CRITICAL";

  if (event === "test") {
    return {
      content: "🧪 **FLARE · DISCORD TEST**",
      embeds: [
        {
          title: "Discord integration connected successfully",
          color: COLOR.info,
          fields: [
            { name: "Environment", value: envLabel(), inline: true },
            { name: "Status", value: "CONNECTED", inline: true },
            { name: "Source", value: "Flare Integrations", inline: true },
          ],
          timestamp: now,
          footer: { text: footerText() },
        },
      ],
    };
  }

  if (event === "incident.resolved") {
    const allClear = room.alertVariant === "all_clear";
    if (allClear) {
      const fields: EmbedField[] = [];
      if (service) fields.push({ name: "Previously affected", value: codeBlock(service) });
      fields.push({ name: "Status", value: "HEALTHY", inline: true });
      fields.push({ name: "Incident ID", value: codeBlock(roomCode), inline: true });
      if (duration) fields.push({ name: "Duration", value: duration, inline: true });
      fields.push({ name: "Link", value: `[View Incident](${publicIncidentUrl(roomCode)})` });
      return {
        content: "✅ **FLARE · ALL CLEAR**",
        embeds: [
          {
            title: "Production systems recovered",
            color: COLOR.ok,
            fields,
            timestamp: now,
            footer: { text: footerText() },
          },
        ],
      };
    }

    const fields: EmbedField[] = [];
    if (service) fields.push({ name: "Service", value: codeBlock(service), inline: true });
    fields.push({ name: "Status", value: "RESOLVED", inline: true });
    if (duration) fields.push({ name: "Duration", value: duration, inline: true });
    fields.push({
      name: "Recovery",
      value:
        room.metrics?.errorRate != null && room.metrics.errorRate < 8
          ? "Error rate returned to normal"
          : "Service recovered",
    });
    fields.push({ name: "Incident ID", value: codeBlock(roomCode), inline: true });
    fields.push({ name: "Link", value: `[View Incident](${publicIncidentUrl(roomCode)})` });
    return {
      content: "✅ **FLARE · INCIDENT RESOLVED**",
      embeds: [
        {
          title: title.length > 80 ? `${title.slice(0, 77)}…` : title,
          description: service ? `${codeBlock(service)} recovered` : undefined,
          color: COLOR.ok,
          fields,
          timestamp: now,
          footer: { text: footerText() },
        },
      ],
    };
  }

  if (event === "incident.escalated") {
    const fields: EmbedField[] = [];
    if (room.previousSeverity) {
      fields.push({
        name: "Severity",
        value: `${sevLabel(room.previousSeverity)} → ${sevLabel(room.severity)}`,
        inline: true,
      });
    } else {
      fields.push({ name: "Severity", value: sevLabel(room.severity), inline: true });
    }
    if (service) fields.push({ name: "Service", value: codeBlock(service), inline: true });
    fields.push({ name: "Status", value: statusLabel(room.status), inline: true });
    if (impact) fields.push({ name: "Reason", value: impact });
    if (evidence.length) fields.push({ name: "Evidence", value: evidence.join("\n") });
    fields.push(incidentField(roomCode));
    fields.push(warRoomField(roomCode));
    return {
      content: "⚠️ **FLARE · INCIDENT ESCALATED**",
      embeds: [
        {
          title: title,
          description: "Requires attention",
          color: sevColor(room.severity),
          fields,
          timestamp: now,
          footer: { text: footerText() },
        },
      ],
    };
  }

  if (event === "service.degraded") {
    const fields: EmbedField[] = [];
    if (service) fields.push({ name: "Service", value: codeBlock(service), inline: true });
    fields.push({ name: "Severity", value: sevLabel(room.severity), inline: true });
    fields.push({ name: "Status", value: statusLabel(room.status), inline: true });
    if (impact) fields.push({ name: "Impact", value: impact });
    if (evidence.length) fields.push({ name: "Evidence", value: evidence.join("\n") });
    fields.push(incidentField(roomCode));
    fields.push(warRoomField(roomCode));
    return {
      content: "🔻 **FLARE · SERVICE DEGRADED**",
      embeds: [
        {
          title: title,
          color: COLOR.degraded,
          fields,
          timestamp: now,
          footer: { text: footerText() },
        },
      ],
    };
  }

  // incident.created (default)
  const fields: EmbedField[] = [
    { name: "Severity", value: sevLabel(room.severity), inline: true },
    { name: "Status", value: statusLabel(room.status), inline: true },
  ];
  if (service) fields.push({ name: "Affected service", value: codeBlock(service) });
  if (room.affected.length > 1) {
    fields.push({
      name: "Also affected",
      value: room.affected
        .filter((s) => s !== service)
        .map(codeBlock)
        .join(" "),
    });
  }
  if (impact) fields.push({ name: "Impact", value: impact });
  if (evidence.length) fields.push({ name: "Evidence", value: evidence.join("\n") });
  fields.push(incidentField(roomCode));
  fields.push(warRoomField(roomCode));

  return {
    content: critical ? "🔴 **FLARE · CRITICAL INCIDENT**" : "🚨 **FLARE INCIDENT**",
    embeds: [
      {
        title: title,
        color: sevColor(room.severity),
        fields,
        timestamp: now,
        footer: { text: footerText() },
      },
    ],
  };
}

/** Notify on 0→N (cascade start) or N→0 (resolved). No-op if webhook unset. */
export async function notifyAffectedTransition(
  roomCode: string,
  prevAffected: string[],
  room: NotifyRoom,
) {
  const url = discordWebhookUrl();
  if (!url) return;

  const next = room.affected ?? [];
  let event: DiscordAlertEvent | null = null;
  let payloadRoom = room;
  if (prevAffected.length === 0 && next.length > 0) event = "service.degraded";
  else if (prevAffected.length > 0 && next.length === 0) {
    event = "incident.resolved";
    payloadRoom = { ...room, alertVariant: "all_clear" };
  }
  if (!event) return;

  const body = buildDiscordAlert(event, roomCode, payloadRoom);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("discord webhook failed", res.status, await res.text());
    } else {
      console.log("discord webhook ok", event, roomCode);
    }
  } catch (err) {
    console.error("discord webhook error", err);
  }
}
