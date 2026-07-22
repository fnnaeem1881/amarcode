import React, { useState, useEffect } from "react";
import type { ProjectMetadata, ChatSession } from "@amarcode/shared";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }

/** Left rail — mirrors the Claude Code desktop: Home (sessions) / Code (files). */
export function Sidebar({
  tab, setTab, projectName, sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession, onDeleteSessions,
  metadata, files, onOpenFile, onOpenProject, onSettings, onIDE, activePath,
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
  onDeleteSessions: (ids: string[]) => void;
  metadata: ProjectMetadata | null;
  files: FileRow[];
  onOpenFile: (path: string) => void;
  onOpenProject: () => void;
  onSettings: () => void;
  onIDE: () => void;
  activePath: string | null;
}) {
  const projOf = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const [menu, setMenu] = useState<{ s: ChatSession; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);

  // Handle plain / Ctrl(⌘) / Shift click for multi-select.
  const onRowClick = (e: React.MouseEvent, s: ChatSession, index: number) => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(sessions.slice(a, b + 1).map((x) => x.id)));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(s.id) ? next.delete(s.id) : next.add(s.id);
        return next;
      });
      setAnchor(index);
    } else {
      setSelected(new Set());
      setAnchor(index);
      onSelectSession(s);
    }
  };

  const clearSelection = () => { setSelected(new Set()); setAnchor(null); };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      else if (e.key === "r" || e.key === "R") rename(menu.s);
      else if (e.key === "d" || e.key === "D") {
        if (selected.size > 1 && selected.has(menu.s.id)) { onDeleteSessions([...selected]); clearSelection(); }
        else onDeleteSession(menu.s.id);
        setMenu(null);
      }
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

      <div className="sb-actions">
        <button className="sb-act" onClick={onIDE} title="Open the file editor (IDE)">⌨ IDE</button>
        <button className="sb-act" onClick={onOpenProject} title="Open a project folder">📂 {projectName || "Project"}</button>
      </div>

      <div className="sb-scroll">
          {selected.size > 0 ? (
            <div className="sb-selbar">
              <span>{selected.size} selected</span>
              <div style={{ flex: 1 }} />
              <button className="danger" onClick={() => { if (confirm(`Delete ${selected.size} sessions?`)) { onDeleteSessions([...selected]); clearSelection(); } }}>Delete {selected.size}</button>
              <button onClick={clearSelection}>Clear</button>
            </div>
          ) : (
            <div className="sb-section">Sessions <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>· shift/⌘-click to select</span></div>
          )}
          {sessions.length === 0 && <div className="hint" style={{ padding: "4px 14px" }}>No sessions yet.</div>}
          {sessions.map((s, index) => (
            <div key={s.id} className={`sb-session ${activeSessionId === s.id ? "active" : ""} ${selected.has(s.id) ? "selected" : ""}`}
              onClick={(e) => onRowClick(e, s, index)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selected.has(s.id)) { setSelected(new Set()); }
                setMenu({ s, x: e.clientX, y: e.clientY });
              }}
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

      <button className="sb-settings" onClick={onSettings}>⚙ AI Settings</button>

      {menu && (
        <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 150) }}
          onClick={(e) => e.stopPropagation()}>
          {selected.size > 1 && selected.has(menu.s.id) ? (
            <button className="danger" onClick={() => { if (confirm(`Delete ${selected.size} sessions?`)) { onDeleteSessions([...selected]); clearSelection(); } setMenu(null); }}>
              Delete {selected.size}<span className="key">D</span>
            </button>
          ) : (
            <>
              <button onClick={() => { onSelectSession(menu.s); setMenu(null); }}>Open<span className="key">↵</span></button>
              <button onClick={() => rename(menu.s)}>Rename<span className="key">R</span></button>
              <div className="ctx-sep" />
              <button className="danger" onClick={() => { onDeleteSession(menu.s.id); setMenu(null); }}>Delete<span className="key">D</span></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
