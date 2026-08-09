import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { checkUrl, createRoom, postEvent, type UrlCheckResult } from "../api";

function resultLabel(r: UrlCheckResult) {
  if (r.isUp) {
    return `Live — ${r.statusCode} OK, ${r.latencyMs}ms`;
  }
  if (r.reason === "timed_out") return `Down — timed out (${r.latencyMs}ms)`;
  if (r.statusCode) return `Down — ${r.statusCode} (${r.latencyMs}ms)`;
  return `Down — ${r.reason || "unreachable"}`;
}

export function UrlCheckPanel() {
  const [url, setUrl] = useState("https://");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UrlCheckResult | null>(null);
  const [roomPath, setRoomPath] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setRoomPath(null);
    try {
      const r = await checkUrl(url.trim());
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  async function openRoom() {
    if (!result) return;
    setOpening(true);
    setError(null);
    try {
      const title = `URL check: ${new URL(result.url).hostname}`;
      const { code, urlPath } = await createRoom(title, "url_check");
      const note = [
        `External URL check`,
        `URL: ${result.url}`,
        `Status: ${result.statusCode ?? "—"}`,
        `Latency: ${result.latencyMs}ms`,
        `Up: ${result.isUp ? "yes" : "no"}`,
        result.reason ? `Reason: ${result.reason}` : null,
        `Checked: ${result.checkedAt}`,
      ]
        .filter(Boolean)
        .join("\n");
      await postEvent(code, note, "url-monitor");
      setRoomPath(urlPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open room");
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="lp-section" id="check-url">
      <div className="lp-section-head">
        <h2>Check your site</h2>
        <p>Real HTTP probe from Flare — status code and latency, not simulated.</p>
      </div>
      <form className="lp-url-check" onSubmit={onSubmit}>
        <label className="lp-url-check-label" htmlFor="check-url-input">
          URL
        </label>
        <div className="lp-url-check-row">
          <input
            id="check-url-input"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            disabled={loading}
          />
          <button type="submit" className="lp-btn primary" disabled={loading || !url.trim()}>
            {loading ? "Checking…" : "Check status"}
          </button>
        </div>
      </form>
      {error ? <p className="lp-url-check-msg err">{error}</p> : null}
      {result ? (
        <div className={`lp-url-check-result ${result.isUp ? "up" : "down"}`}>
          <strong>{resultLabel(result)}</strong>
          <span className="muted">{result.url}</span>
          {!result.isUp && result.reason ? (
            <span className="lp-url-check-reason">{result.reason.replace(/_/g, " ")}</span>
          ) : null}
          <div className="lp-url-check-actions">
            {roomPath ? (
              <Link className="lp-btn ghost" to={roomPath}>
                Open war room
              </Link>
            ) : (
              <button type="button" className="lp-btn ghost" onClick={openRoom} disabled={opening}>
                {opening ? "Opening…" : "Open incident room for this check"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
