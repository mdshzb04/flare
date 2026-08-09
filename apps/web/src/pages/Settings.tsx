import { Link } from "react-router-dom";

export function Settings() {
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <section className="card">
        <h3>Demo mode</h3>
        <p>
          Flare runs a worker load simulator that publishes real ticking metrics over Valkey. Cascade,
          timeline, Discord/webhooks, and Postgres writes are real — numbers are labeled{" "}
          <strong>DEMO</strong> so judges are not misled.
        </p>
        <p className="muted">
          Investigator answers are deterministic and evidence-only (no external LLM key required).
        </p>
        <p>
          Platform map: <Link to="/architecture">Architecture</Link>
        </p>
      </section>
    </>
  );
}
