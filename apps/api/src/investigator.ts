export type TimelineItem = {
  id: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string | Date;
};

export type InvestigateInput = {
  title: string;
  severity: string;
  status: string;
  affected: string[];
  blastRoot: string | null;
  events: TimelineItem[];
  latestMetrics?: {
    errorRate: number;
    latencyMs: number;
    queueDepth: number;
    degradedPct: number;
  } | null;
};

export type InvestigateResult = {
  likelyRootCause: string | null;
  confidence: number;
  evidence: { id: string; text: string }[];
  affectedServices: string[];
  recommendedNext: string[];
  insufficient: boolean;
};

const DEPS: Record<string, string[]> = {
  frontend: ["api"],
  api: ["db", "redis", "storage"],
  worker: ["redis", "db", "storage", "api"],
  db: [],
  redis: [],
  storage: [],
};

export function investigate(input: InvestigateInput): InvestigateResult {
  const evidence: { id: string; text: string }[] = [];
  const affected = input.affected ?? [];

  if (input.blastRoot) {
    evidence.push({
      id: "blastRoot",
      text: `Blast epicenter recorded as ${input.blastRoot}`,
    });
  }

  const hops = input.events.filter((e) => e.kind === "cascade.hop" || e.kind === "affected.changed");
  if (hops.length) {
    const first = hops[0];
    evidence.push({
      id: first.id,
      text: first.summary || "Affected services changed during cascade",
    });
  }

  const thresholds = input.events.filter((e) => e.kind === "metric.threshold");
  for (const t of thresholds.slice(0, 3)) {
    evidence.push({ id: t.id, text: t.summary });
  }

  const tel = input.events.filter((e) => e.kind.startsWith("telemetry."));
  for (const t of tel.slice(0, 2)) {
    evidence.push({ id: t.id, text: t.summary });
  }

  if (input.latestMetrics && input.latestMetrics.errorRate >= 5) {
    evidence.push({
      id: "metrics-error",
      text: `Live error rate ${input.latestMetrics.errorRate.toFixed(1)}% (elevated)`,
    });
  }
  if (input.latestMetrics && input.latestMetrics.latencyMs >= 150) {
    evidence.push({
      id: "metrics-latency",
      text: `Live latency ${Math.round(input.latestMetrics.latencyMs)}ms (elevated)`,
    });
  }

  // Dedupe by id
  const seen = new Set<string>();
  const uniq = evidence.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));

  if (uniq.length < 2) {
    return {
      likelyRootCause: null,
      confidence: 0,
      evidence: uniq,
      affectedServices: affected,
      recommendedNext: [
        "Mark a service down to generate cascade evidence",
        "Ingest telemetry or wait for metric threshold events",
      ],
      insufficient: true,
    };
  }

  const root = input.blastRoot || affected[0] || null;
  let likely: string | null = null;
  let confidence = Math.min(35 + uniq.length * 12, 78);

  if (root) {
    const deps = DEPS[root] || [];
    likely = `Degradation consistent with failure originating at ${root}` +
      (deps.length ? ` (depends on ${deps.join(", ")})` : "");
  } else if (thresholds.length) {
    likely = "Metric thresholds crossed without a clear blast epicenter";
    confidence = Math.min(confidence, 55);
  }

  const recommendedNext: string[] = [];
  if (root) recommendedNext.push(`Inspect ${root} logs and recent deploys`);
  if (affected.includes("db")) recommendedNext.push("Check Postgres connections / slow queries");
  if (affected.includes("redis")) recommendedNext.push("Check Valkey memory and pub/sub lag");
  if (!recommendedNext.length) recommendedNext.push("Expand blast map and collect more timeline events");

  return {
    likelyRootCause: likely,
    confidence,
    evidence: uniq.slice(0, 8),
    affectedServices: affected,
    recommendedNext,
    insufficient: !likely,
  };
}

export function askIncident(question: string, input: InvestigateInput, report: InvestigateResult): {
  answer: string;
  insufficient: boolean;
} {
  const q = question.toLowerCase();
  if (report.insufficient && (q.includes("why") || q.includes("root"))) {
    return {
      answer: "Insufficient evidence to determine the root cause.",
      insufficient: true,
    };
  }

  if (q.includes("affected first") || q.includes("first service") || q.includes("epicenter")) {
    const root = input.blastRoot || input.affected[0];
    if (!root) {
      return { answer: "Insufficient evidence to determine the root cause.", insufficient: true };
    }
    return {
      answer: `Evidence points to ${root} as the first impacted / epicenter service.`,
      insufficient: false,
    };
  }

  if (q.includes("affected") || q.includes("which service")) {
    if (!input.affected.length) {
      return { answer: "No services are currently in the blast radius.", insufficient: false };
    }
    return {
      answer: `Currently affected: ${input.affected.join(", ")}.`,
      insufficient: false,
    };
  }

  if (q.includes("next") || q.includes("investigate")) {
    return {
      answer: report.recommendedNext.join(" ") || "Collect more timeline evidence before acting.",
      insufficient: report.insufficient,
    };
  }

  if (q.includes("why") || q.includes("happen") || q.includes("cause")) {
    if (!report.likelyRootCause) {
      return {
        answer: "Insufficient evidence to determine the root cause.",
        insufficient: true,
      };
    }
    const ev = report.evidence
      .slice(0, 3)
      .map((e, i) => `${i + 1}. ${e.text}`)
      .join(" ");
    return {
      answer: `${report.likelyRootCause} Confidence ${report.confidence}%. Evidence: ${ev}`,
      insufficient: false,
    };
  }

  if (q.includes("evidence") || q.includes("support")) {
    if (report.evidence.length < 2) {
      return {
        answer: "Insufficient evidence to determine the root cause.",
        insufficient: true,
      };
    }
    return {
      answer: report.evidence.map((e, i) => `${i + 1}. ${e.text}`).join(" "),
      insufficient: false,
    };
  }

  return {
    answer:
      "Ask about root cause, first affected service, current affected services, evidence, or what to investigate next.",
    insufficient: false,
  };
}
