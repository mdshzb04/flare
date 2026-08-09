import { FormEvent, useEffect, useState } from "react";
import { getIntegrations, putIntegration, testIntegration } from "../api";

const EVENTS = ["incident.created", "incident.escalated", "service.degraded", "incident.resolved"];

export function Integrations() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getIntegrations>>["integrations"]>([]);
  const [kind, setKind] = useState("discord");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [events, setEvents] = useState<string[]>(EVENTS);
  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);

  async function reload() {
    const d = await getIntegrations();
    setRows(d.integrations);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    await putIntegration({ kind, url: url || undefined, enabled, events });
    setUrl("");
    setMsg("Saved (webhook URL stored server-side only)");
    await reload();
  }

  async function sendTest() {
    setTesting(true);
    setMsg("");
    try {
      const res = await testIntegration(kind);
      setMsg(
        res.ok
          ? `Test alert delivered (HTTP ${res.status ?? "2xx"})`
          : `Test failed: ${res.error || "unknown"}`,
      );
      if (res.integrations) setRows(res.integrations as typeof rows);
      else await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "test failed");
    } finally {
      setTesting(false);
    }
  }

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
  }

  return (
    <>
      <div className="page-head">
        <h1>Integrations</h1>
      </div>
      <div className="split-2">
        <section className="card">
          <h3>Configured</h3>
          <ul className="svc-list">
            {rows.map((r) => (
              <li key={r.id} style={{ flexWrap: "wrap" }}>
                <strong>{r.kind}</strong>
                <span className="muted">{r.enabled ? "enabled" : "disabled"}</span>
                <span className="muted">{r.configured ? "● Configured" : "○ Not configured"}</span>
                <span className="muted">
                  Last delivery:{" "}
                  {r.lastDeliveryStatus === "ok"
                    ? "OK"
                    : r.lastDeliveryStatus === "failed"
                      ? `Failed${r.lastError ? ` (${r.lastError})` : ""}`
                      : "—"}
                </span>
                {r.lastDeliveryAt ? (
                  <span className="mono muted">{new Date(r.lastDeliveryAt).toLocaleString()}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" disabled={testing} onClick={() => void sendTest()} style={{ marginTop: "0.75rem" }}>
            {testing ? "Sending…" : "Send Test Alert"}
          </button>
        </section>
        <section className="card">
          <h3>Upsert webhook</h3>
          <form className="stack-form" onSubmit={(e) => void save(e)}>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="discord">Discord</option>
                <option value="webhook">Generic webhook</option>
              </select>
            </label>
            <label>
              Webhook URL {rows.find((r) => r.kind === kind)?.configured ? "(leave blank to keep)" : ""}
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/…"
                type="password"
                autoComplete="off"
              />
            </label>
            <label className="row">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <div>
              <div className="muted" style={{ marginBottom: "0.4rem" }}>
                Events
              </div>
              {EVENTS.map((ev) => (
                <label key={ev} className="row" style={{ marginBottom: "0.25rem" }}>
                  <input
                    type="checkbox"
                    checked={events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                  />
                  {ev}
                </label>
              ))}
            </div>
            <button className="primary" type="submit">
              Save
            </button>
            {msg ? <p className="muted">{msg}</p> : null}
          </form>
        </section>
      </div>
    </>
  );
}
