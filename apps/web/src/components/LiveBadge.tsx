type Props = { kind: "LIVE" | "DEMO" | "CONNECTED" | "UNKNOWN" };

export function LiveBadge({ kind }: Props) {
  return <span className={`live-badge ${kind.toLowerCase()}`}>{kind}</span>;
}
