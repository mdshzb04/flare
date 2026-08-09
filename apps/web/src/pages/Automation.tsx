import { FormEvent, useEffect, useState } from "react";
import { createAutomationRule, getAutomationRules, patchAutomationRule } from "../api";

export function Automation() {
  const [rules, setRules] = useState<Awaited<ReturnType<typeof getAutomationRules>>["rules"]>([]);
  const [name, setName] = useState("Error rate spike");
  const [metric, setMetric] = useState("errorRate");
  const [value, setValue] = useState(8);

  async function reload() {
    setRules((await getAutomationRules()).rules);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await createAutomationRule({
      name,
      enabled: true,
      trigger: { metric, op: "gt", value },
      actions: ["create_incident", "discord_alert"],
    });
    await reload();
  }

  return (
    <>
      <div className="page-head">
        <h1>Automation</h1>
        <p className="muted">Worker evaluates rules against live DEMO metrics every few seconds.</p>
      </div>
      <div className="split-2">
        <section className="card">
          <h3>Rules</h3>
          <ul className="svc-list">
            {rules.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span className="mono muted">
                  {r.trigger.metric} {r.trigger.op} {r.trigger.value}
                </span>
                <button
                  type="button"
                  onClick={() => void patchAutomationRule(r.id, { enabled: !r.enabled }).then(reload)}
                >
                  {r.enabled ? "Disable" : "Enable"}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h3>New rule</h3>
          <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Metric
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                <option value="errorRate">errorRate</option>
                <option value="latencyMs">latencyMs</option>
                <option value="queueDepth">queueDepth</option>
                <option value="degradedPct">degradedPct</option>
              </select>
            </label>
            <label>
              Greater than
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
              />
            </label>
            <p className="muted" style={{ fontSize: "0.78rem" }}>
              Actions: create_incident + discord_alert
            </p>
            <button className="primary" type="submit">
              Create rule
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
