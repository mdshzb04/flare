/** Outbound Discord webhook — fire-and-forget from room affected transitions. */

export type NotifyRoom = {
  title: string;
  severity: string;
  status: string;
  affected: string[];
  blastRoot?: string | null;
};

export function discordWebhookUrl() {
  return (process.env.DISCORD_WEBHOOK_URL || "").trim();
}

export function publicRoomUrl(roomCode: string) {
  const base = (process.env.PUBLIC_APP_URL || "https://frontend-2b1c.prg1.zerops.app").replace(/\/$/, "");
  return `${base}/r/${roomCode}`;
}

export function buildDiscordPayload(
  kind: "down" | "clear",
  roomCode: string,
  room: NotifyRoom,
) {
  const link = publicRoomUrl(roomCode);
  if (kind === "down") {
    return {
      content: `🚨 **Flare** — cascade started`,
      embeds: [
        {
          title: room.title.slice(0, 200),
          color: 0xe74c3c,
          fields: [
            { name: "Severity", value: room.severity, inline: true },
            { name: "Status", value: room.status, inline: true },
            {
              name: "Epicenter",
              value: room.blastRoot || room.affected[0] || "—",
              inline: true,
            },
            {
              name: "Affected",
              value: room.affected.length ? room.affected.join(", ") : "—",
            },
            { name: "War-room", value: `[Open live room](${link})` },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }
  return {
    content: `✅ **Flare** — all clear`,
    embeds: [
      {
        title: room.title.slice(0, 200),
        color: 0x2ecc71,
        fields: [
          { name: "Severity", value: room.severity, inline: true },
          { name: "Status", value: room.status, inline: true },
          { name: "Blast radius", value: "cleared" },
          { name: "War-room", value: `[Open live room](${link})` },
        ],
        timestamp: new Date().toISOString(),
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
  let kind: "down" | "clear" | null = null;
  if (prevAffected.length === 0 && next.length > 0) kind = "down";
  else if (prevAffected.length > 0 && next.length === 0) kind = "clear";
  if (!kind) return;

  const body = buildDiscordPayload(kind, roomCode, room);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("discord webhook failed", res.status, await res.text());
    } else {
      console.log("discord webhook ok", kind, roomCode);
    }
  } catch (err) {
    console.error("discord webhook error", err);
  }
}
