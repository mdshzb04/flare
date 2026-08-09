export type RuleTrigger = {
  metric: "errorRate" | "latencyMs" | "queueDepth" | "degradedPct";
  op: "gt";
  value: number;
};

export type MetricsSnapshot = {
  errorRate: number;
  latencyMs: number;
  queueDepth: number;
  degradedPct: number;
};

export function matchRule(trigger: RuleTrigger, metrics: MetricsSnapshot): boolean {
  if (!trigger || trigger.op !== "gt") return false;
  const v =
    trigger.metric === "errorRate"
      ? metrics.errorRate
      : trigger.metric === "latencyMs"
        ? metrics.latencyMs
        : trigger.metric === "queueDepth"
          ? metrics.queueDepth
          : trigger.metric === "degradedPct"
            ? metrics.degradedPct
            : NaN;
  if (Number.isNaN(v)) return false;
  return v > Number(trigger.value);
}
