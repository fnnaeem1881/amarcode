import { useEffect, useState, useCallback } from "react";
import { api, type GitStatus } from "../api.js";
import { DiffView } from "./DiffView.js";

/** VS Code–style source-control panel: branch, changes, staging, diff, commit. */
export function GitPanel({ root, refreshKey }: { root: string; refreshKey: number }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<{ current: string; all: string[] }>({ current: "", all: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const s = await api.gitStatus(root);
      setStatus(s);
      setError("");
      if (s.isRepo) setBranches(await api.gitBranches(root).catch(() => ({ current: s.branch ?? "", all: [] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [root]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const openDiff = async (path: string, staged: boolean) => {
    setSelected(path);
    try { setDiff((await api.gitDiff(root, path, staged)).diff || "(no textual diff)"); }
    catch { setDiff(""); }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refresh(); if (selected) await openDiff(selected, false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!message.trim()) return;
    await act(async () => { await api.gitCommit(root, message); setMessage(""); setSelected(null); setDiff(""); });
  };

  if (!status) return <div className="tab-body"><span className="hint">{error || "Loading git…"}</span></div>;

  if (!status.isRepo) {
    return (
      <div className="tab-body" style={{ fontFamily: "var(--font)" }}>
        <span className="hint">Not a git repository. </span>
        <button className="btn ghost" disabled={busy} onClick={() => act(() => api.gitInit(root))}>git init</button>
        {error && <div style={{ color: "var(--red)", marginTop: 6 }}>{error}</div>}
      </div>
    );
  }

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  return (
    <div className="git-panel">
      <div className="git-side">
        <div className="git-branchbar">
          <select value={branches.current} disabled={busy}
            onChange={(e) => act(() => api.gitCheckout(root, e.target.value))}
            title="Switch branch">
            {branches.all.length ? branches.all.map((b) => <option key={b} value={b}>⎇ {b}</option>) : <option>{status.branch}</option>}
          </select>
          <button className="btn ghost" title="New branch" disabled={busy}
            onClick={() => { const n = prompt("New branch name:"); if (n) act(() => api.gitBranch(root, n)); }}>+</button>
          <button className="btn ghost" title="Refresh" onClick={refresh}>↻</button>
          {status.ahead > 0 && <span className="hint">↑{status.ahead}</span>}
          {status.behind > 0 && <span className="hint">↓{status.behind}</span>}
        </div>

        <div className="commit-box">
          <input placeholder="Commit message" value={message} disabled={busy}
            onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <button className="btn" disabled={busy || !message.trim() || !status.files.length} onClick={commit}>
            ✓ Commit {staged.length ? `(${staged.length})` : "all"}
          </button>
        </div>

        {error && <div style={{ color: "var(--red)", padding: "4px 8px", fontSize: 11 }}>{error}</div>}

        <FileGroup title={`Staged (${staged.length})`} files={staged} selected={selected}
          onOpen={(p) => openDiff(p, true)} action={(p) => act(() => api.gitUnstage(root, p))} actionLabel="−" />
        <FileGroup title={`Changes (${unstaged.length})`} files={unstaged} selected={selected}
          onOpen={(p) => openDiff(p, false)}
          action={(p) => act(() => api.gitStage(root, p))} actionLabel="+"
          discard={(p) => { if (confirm(`Discard changes to ${p}? This cannot be undone.`)) act(() => api.gitDiscard(root, p)); }} />

        {!status.files.length && <div className="hint" style={{ padding: 8 }}>Working tree clean ✓</div>}
      </div>

      <div className="git-diff">
        {selected ? <DiffView unified={diff} /> : <div className="hint" style={{ padding: 12 }}>Select a file to view its diff.</div>}
      </div>
    </div>
  );
}

function FileGroup({
  title, files, selected, onOpen, action, actionLabel, discard,
}: {
  title: string;
  files: { path: string; index: string; working: string }[];
  selected: string | null;
  onOpen: (p: string) => void;
  action: (p: string) => void;
  actionLabel: string;
  discard?: (p: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="git-group">
      <div className="git-group-title">{title}</div>
      {files.map((f) => (
        <div key={f.path} className={`git-file ${selected === f.path ? "active" : ""}`} onClick={() => onOpen(f.path)}>
          <span className={`git-badge s-${statusChar(f)}`}>{statusChar(f)}</span>
          <span className="git-path">{f.path}</span>
          <span className="git-actions">
            {discard && <button title="Discard" onClick={(e) => { e.stopPropagation(); discard(f.path); }}>↺</button>}
            <button title={actionLabel === "+" ? "Stage" : "Unstage"} onClick={(e) => { e.stopPropagation(); action(f.path); }}>{actionLabel}</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function statusChar(f: { index: string; working: string }): string {
  const c = f.working !== " " && f.working !== "" ? f.working : f.index;
  if (c === "?") return "U"; // untracked
  return c || "M";
}
