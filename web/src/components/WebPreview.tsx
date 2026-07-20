import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

/**
 * Embedded browser preview + dev-server controls. Run a dev server (manually or
 * via the agent), see the app live, read logs to find bugs, and reload.
 */
export function WebPreview({ root, url, onUrlChange }: { root: string; url: string; onUrlChange: (u: string) => void }) {
  const [input, setInput] = useState(url);
  const [command, setCommand] = useState("npm run dev");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setInput(url); }, [url]);

  // Poll server status/logs while running.
  useEffect(() => {
    if (!root) return;
    const tick = async () => {
      try {
        const st = await api.previewStatus(root);
        setRunning(st.running);
        setLogs(st.logs);
        if (st.url && st.url !== url) onUrlChange(st.url);
      } catch { /* engine may be busy */ }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const go = (u: string) => {
    const norm = u.trim().startsWith("http") ? u.trim() : `http://${u.trim()}`;
    onUrlChange(norm);
    setKey((k) => k + 1);
  };

  const run = async () => {
    setBusy(true);
    try {
      const st = await api.previewStart(root, command);
      setRunning(st.running);
      if (st.url) { onUrlChange(st.url); setKey((k) => k + 1); }
      setShowLogs(true);
    } finally { setBusy(false); }
  };
  const stop = async () => { await api.previewStop(root).catch(() => {}); setRunning(false); };

  return (
    <div className="webview">
      <div className="webview-bar">
        <button className="cc-icon" title="Reload" onClick={() => setKey((k) => k + 1)}>↻</button>
        <input value={input} spellCheck={false} placeholder="http://localhost:3000"
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(input)} />
        <button className="cc-icon" onClick={() => go(input)}>Go</button>
        {url && <a className="cc-icon" href={url} target="_blank" rel="noreferrer" title="Open in real browser">↗</a>}
      </div>

      <div className="webview-run">
        <span className={`run-dot ${running ? "on" : ""}`} />
        <input className="run-cmd" value={command} onChange={(e) => setCommand(e.target.value)}
          placeholder="npm run dev" onKeyDown={(e) => e.key === "Enter" && run()} />
        {running
          ? <button className="btn ghost sm" onClick={stop}>■ Stop</button>
          : <button className="btn sm" onClick={run} disabled={busy || !root}>{busy ? "Starting…" : "▶ Run"}</button>}
        <button className={`cc-icon ${showLogs ? "on" : ""}`} onClick={() => setShowLogs((v) => !v)}>Logs</button>
      </div>

      <div className="webview-main">
        {url ? (
          <iframe key={key} ref={iframeRef} className="webview-frame" src={url} title="preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
        ) : (
          <div className="webview-empty">
            <div style={{ fontSize: 40, marginBottom: 12 }}>🌐</div>
            <div className="cc-empty-title">Web Preview</div>
            <div className="hint">Run a dev server above (or ask the assistant to) — the URL is auto-detected.</div>
          </div>
        )}
        {showLogs && (
          <div className="webview-logs">
            <div className="webview-logs-head">Server logs {running ? "· running" : ""}</div>
            <pre>{logs || "(no output yet)"}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
