import { useState, useEffect } from "react";
import type { ProjectMetadata, ChatSession } from "@amarcode/shared";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }

/** Left rail — mirrors the Claude Code desktop: Home (sessions) / Code (files). */
export function Sidebar({
  tab, setTab, projectName, sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession,
  metadata, files, onOpenFile, onOpenProject, onSettings, activePath,
}: {
  tab: "home" | "code";
  setTab: (t: "home" | "code") => void;
  projectName: string;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (s: ChatSession) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  metadata: ProjectMetadata | null;
  files: FileRow[];
  onOpenFile: (path: string) => void;
  onOpenProject: () => void;
  onSettings: () => void;
  activePath: string | null;
}) {
  const projOf = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const [menu, setMenu] = useState<{ s: ChatSession; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      else if (e.key === "r" || e.key === "R") rename(menu.s);
      else if (e.key === "d" || e.key === "D") { onDeleteSession(menu.s.id); setMenu(null); }
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const rename = (s: ChatSession) => {
    const t = prompt("Rename session:", s.title);
    if (t && t.trim()) onRenameSession(s.id, t.trim());
    setMenu(null);
  };
  return (
    <div className="sidebar">
      <div className="sb-brand">
        <span className="brand">◆ AmarCode</span>
      </div>

      <div className="sb-tabs">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>⌂ Home</button>
        <button className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}>&lt;/&gt; Code</button>
      </div>

      <button className="sb-new" onClick={onNewSession}>+ New session</button>

      <button className="sb-project" onClick={onOpenProject} title="Open a project folder">
        📂 <span>{projectName || "Open project"}</span>
      </button>

      {tab === "home" ? (
        <div className="sb-scroll">
          <div className="sb-section">Sessions</div>
          {sessions.length === 0 && <div className="hint" style={{ padding: "4px 14px" }}>No sessions yet.</div>}
          {sessions.map((s) => (
            <div key={s.id} className={`sb-session ${activeSessionId === s.id ? "active" : ""}`}
              onClick={() => onSelectSession(s)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ s, x: e.clientX, y: e.clientY }); }}
              title={`${projOf(s.projectRoot)} · ${new Date(s.updatedAt).toLocaleString()}`}>
              {activeSessionId === s.id && <span className="dot" />}
              <div className="sb-session-text">
                <span className="title">{s.title}</span>
                <span className="proj">{projOf(s.projectRoot)}</span>
              </div>
              <button className="sb-del" title="More"
                onClick={(e) => { e.stopPropagation(); setMenu({ s, x: e.clientX, y: e.clientY }); }}>⋯</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="sb-scroll">
          {metadata && (
            <div className="sb-meta">
              <span className="badge">{metadata.framework}</span>
              <span className="badge">{metadata.language}</span>
              {metadata.database && <span className="badge">{metadata.database}</span>}
            </div>
          )}
          <div className="sb-section">Files ({files.length})</div>
          {files.slice().sort((a, b) => b.importance - a.importance).map((f) => (
            <div key={f.path} className={`sb-file ${activePath === f.path ? "active" : ""}`}
              onClick={() => onOpenFile(f.path)} title={f.path}>
              {f.path.split("/").pop()}
            </div>
          ))}
          {!files.length && <div className="hint" style={{ padding: "4px 14px" }}>Open a project to see files.</div>}
        </div>
      )}

      <button className="sb-settings" onClick={onSettings}>⚙ AI Settings</button>

      {menu && (
        <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 150) }}
          onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onSelectSession(menu.s); setMenu(null); }}>Open<span className="key">↵</span></button>
          <button onClick={() => rename(menu.s)}>Rename<span className="key">R</span></button>
          <div className="ctx-sep" />
          <button className="danger" onClick={() => { onDeleteSession(menu.s.id); setMenu(null); }}>Delete<span className="key">D</span></button>
        </div>
      )}
    </div>
  );
}
