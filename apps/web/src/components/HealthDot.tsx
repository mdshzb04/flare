type Props = { status: string };

export function HealthDot({ status }: Props) {
  const s = status === "down" || status === "degraded" ? status : status === "healthy" ? "ok" : "unknown";
  return <i className={`health-dot ${s}`} aria-label={status} />;
}
