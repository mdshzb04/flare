import { lazy, Suspense, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { IncidentPreview } from "../components/IncidentPreview";
import { UrlCheckPanel } from "../components/UrlCheckPanel";

const Vortex = lazy(() => import("@/components/originkit/ui/tornado"));

const FEATURES = [
  {
    title: "Live war rooms",
    body: "Shared timeline, blast map, and presence while the incident is still hot.",
  },
  {
    title: "Blast radius + cascade",
    body: "Mark a service down and watch dependency hops propagate with live metrics.",
  },
  {
    title: "Evidence-first",
    body: "Notes, screenshots, and timeline events in one room — same truth for everyone.",
  },
  {
    title: "URL health checks",
    body: "Probe any public URL for status and latency — indexed on your dashboard.",
  },
  {
    title: "Alerting",
    body: "Incident and recovery notifications through Discord and webhooks.",
  },
  {
    title: "Recovery",
    body: "Resolve incidents, reverse cascade, and send all-clear when you are done.",
  },
];

const PIPELINE = [
  { title: "Signal", body: "Mark impact on the blast map or probe an external URL." },
  { title: "Flare", body: "Persist room state, timeline, and fan-out over Valkey." },
  { title: "War room", body: "Operators collaborate on one shared live view." },
  { title: "Metrics", body: "Worker ticks load/error/latency numbers into open rooms." },
  { title: "Evidence", body: "Notes and screenshot uploads land in the timeline." },
  { title: "Alert", body: "Discord/webhook notifications on escalate and resolve." },
  { title: "Resolution", body: "Reverse cascade and close the incident." },
];

const STACK_TIERS = [
  {
    label: "Runtime",
    items: [
      { id: "frontend", role: "UI", kind: "compute" as const },
      { id: "api", role: "HTTP + WS", kind: "compute" as const },
      { id: "worker", role: "Jobs + detection", kind: "compute" as const },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "postgres", role: "State", kind: "data" as const },
      { id: "valkey", role: "Realtime", kind: "realtime" as const },
      { id: "storage", role: "Objects", kind: "storage" as const },
    ],
  },
];

/** Pipeline steps that are Flare's core moments — highlighted visually. */
const PIPELINE_FOCUS = new Set(["Flare", "War room"]);

export function Landing() {
  const heroRef = useRef<HTMLElement>(null);

  const onHeroPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const el = heroRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--parx", (x * 5).toFixed(2));
    el.style.setProperty("--pary", (y * 3.5).toFixed(2));
  };

  const onHeroPointerLeave = () => {
    const el = heroRef.current;
    if (!el) return;
    el.style.setProperty("--parx", "0");
    el.style.setProperty("--pary", "0");
  };

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden />
      <header className="lp-nav">
        <a className="brand lp-brand" href="#top">
          Fla<span>re</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#architecture">Architecture</a>
          <a href="#demo">Demo</a>
        </nav>
        <Link className="lp-nav-cta" to="/dashboard">
          Open Dashboard
        </Link>
      </header>

      <main id="top">
        <section
          ref={heroRef}
          className="lp-hero"
          onPointerMove={onHeroPointerMove}
          onPointerLeave={onHeroPointerLeave}
        >
          <div className="lp-tornado" aria-hidden>
            <Suspense fallback={null}>
              <Vortex
                background="transparent"
                zoom={62}
                speed={8}
                twist={2.4}
                topRadius={320}
                waistRadius={48}
                bottomRadius={980}
                lineOptions={{ count: 160, color: "#c45a28", glow: 6 }}
                dotOptions={{ count: 4200, size: 14, color: "#8a4a2e", glow: 5, flicker: 7 }}
                cometOptions={{
                  count: 8,
                  speed: 5,
                  color: "#ff4d18",
                  glow: 8,
                  tail: 18,
                  delay: 7,
                  collide: 5,
                }}
                repel
                repelOptions={{ radius: 70, strength: 12 }}
              />
            </Suspense>
          </div>
          <div className="lp-hero-scrim" aria-hidden />
          <div className="lp-hero-copy">
            <p className="lp-brand-mark">
              Fla<span>re</span>
            </p>
            <h1>Incident response when production actually breaks.</h1>
            <p className="lp-lede">
              Real telemetry in. Live incidents, evidence, and war rooms out.
            </p>
            <div className="lp-cta-row">
              <Link className="lp-btn primary" to="/dashboard">
                Open Dashboard
              </Link>
              <a className="lp-btn ghost" href="#how">
                How it works
              </a>
            </div>
          </div>
        </section>

        <section className="lp-section lp-band lp-preview-section" aria-label="Product preview">
          <div className="lp-section-head">
            <h2>What an incident looks like</h2>
            <p>Product preview — animated walkthrough, not live production data.</p>
          </div>
          <div className="lp-hero-visual">
            <IncidentPreview />
          </div>
        </section>

        <section className="lp-section" id="product">
          <div className="lp-section-head">
            <h2>Built for the moment something breaks</h2>
            <p>
              Real-time incident response for applications in production — from first signal to
              all-clear.
            </p>
          </div>
          <div className="lp-feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="lp-feature">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-band" id="how">
          <div className="lp-section-head">
            <h2>How it works</h2>
            <p>A single pipeline from your app to a resolved incident.</p>
          </div>
          <ol className="lp-pipeline">
            {PIPELINE.map((step, i) => {
              const focus = PIPELINE_FOCUS.has(step.title);
              return (
                <li
                  key={step.title}
                  className={[
                    i % 2 === 1 ? "lp-pipeline-alt" : "",
                    focus ? "lp-pipeline-focus" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="lp-step-num" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="lp-step-body">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="lp-section" id="architecture">
          <div className="lp-section-head">
            <h2>Built for real infrastructure</h2>
            <p>
              Flare runs as a multi-service application on Zerops, with real-time event processing,
              persistent incident state, and service-to-service communication.
            </p>
          </div>
          <div className="lp-stack-tiers">
            {STACK_TIERS.map((tier) => (
              <div key={tier.label} className="lp-stack-tier">
                <p className="lp-stack-tier-label">{tier.label}</p>
                <div className="lp-stack">
                  {tier.items.map((s) => (
                    <div key={s.id} className={`lp-stack-card kind-${s.kind}`}>
                      <span className="lp-stack-dot" aria-hidden />
                      <strong>{s.id}</strong>
                      <span>{s.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <UrlCheckPanel />

        <section className="lp-section lp-band lp-demo" id="demo">
          <div className="lp-section-head">
            <h2>See it in action</h2>
            <p>
              Open a war room, mark a service on the blast map, and watch cascade hops land in the
              timeline with live metrics ticking over Valkey. Upload screenshots, send Discord alerts,
              and resolve when you are clear.
            </p>
          </div>
          <ol className="lp-demo-flow">
            {[
              "Open war room",
              "Mark service down",
              "Cascade + metrics",
              "Collaborate live",
              "Alert + resolve",
            ].map((label) => (
              <li key={label}>
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <Link className="lp-btn primary" to="/dashboard">
            Open the dashboard
          </Link>
        </section>

        <section className="lp-final">
          <h2>Stop guessing what went wrong.</h2>
          <p>See your next incident as it happens.</p>
          <div className="lp-cta-row">
            <Link className="lp-btn primary" to="/dashboard">
              Open Flare
            </Link>
            <Link className="lp-btn ghost" to="/architecture">
              View architecture
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="brand">
          Fla<span>re</span>
        </span>
        <span className="muted">Incident response for production systems</span>
      </footer>
    </div>
  );
}
