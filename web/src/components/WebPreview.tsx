import { useEffect, useRef, useState } from "react";

/**
 * Embedded browser preview. Point it at a running dev server (auto-detected from
 * terminal output, or typed) and see the app live — like a built-in browser.
 */
export function WebPreview({ url, onUrlChange }: { url: string; onUrlChange: (u: string) => void }) {
  const [input, setInput] = useState(url);
  const [key, setKey] = useState(0); // bump to force iframe reload
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setInput(url); }, [url]);

  const go = (u: string) => {
    const norm = u.trim().startsWith("http") ? u.trim() : `http://${u.trim()}`;
    onUrlChange(norm);
    setKey((k) => k + 1);
  };

  return (
    <div className="webview">
      <div className="webview-bar">
        <button className="cc-icon" title="Reload" onClick={() => setKey((k) => k + 1)}>↻</button>
        <input
          value={input}
          spellCheck={false}
          placeholder="http://localhost:3000"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go(input)}
        />
        <button className="cc-icon" onClick={() => go(input)}>Go</button>
        {url && <a className="cc-icon" href={url} target="_blank" rel="noreferrer" title="Open in real browser">↗</a>}
      </div>
      {url ? (
        <iframe key={key} ref={iframeRef} className="webview-frame" src={url} title="preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
      ) : (
        <div className="webview-empty">
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌐</div>
          <div className="cc-empty-title">Web Preview</div>
          <div className="hint">Run a dev server (e.g. <code>npm run dev</code>) — the URL is auto-detected — or type one above.</div>
        </div>
      )}
    </div>
  );
}
