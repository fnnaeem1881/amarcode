import { useEffect, useRef, useState, useCallback } from "react";
import type { ProjectMetadata, SafeProviderConfig, ChatSession, Plan } from "@amarcode/shared";
import { api } from "./api.js";
import { AgentSocket } from "./ws.js";
import { ProjectPicker } from "./components/ProjectPicker.js";
import { Sidebar } from "./components/Sidebar.js";
import { BottomPanel } from "./components/BottomPanel.js";
import { Chat } from "./components/Chat.js";
import { Settings } from "./components/Settings.js";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }
interface GitInfo { isRepo: boolean; branch: string; add: number; del: number; files: number }

export function App() {
  const [root, setRoot] = useState<string>(() => localStorage.getItem("root") ?? "");
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");

  const [providers, setProviders] = useState<SafeProviderConfig[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"home" | "code">("home");

  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  const [terminal, setTerminal] = useState("");
  const [gitRefreshKey, setGitRefreshKey] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ isRepo: false, branch: "", add: 0, del: 0, files: 0 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [memory, setMemory] = useState<any>(null);
  const [problems] = useState<string[]>([]);

  const socketRef = useRef<AgentSocket | null>(null);

  useEffect(() => {
    const s = new AgentSocket();
    s.connect().then(() => (socketRef.current = s)).catch(() => setStatus("engine offline"));
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    if (root) { localStorage.setItem("root", root); void openProject(root); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Refresh git branch + diff stat for the commit bar.
  const refreshGit = useCallback(async () => {
    if (!root) return;
    try {
      const s = await api.gitStatus(root);
      let add = 0, del = 0;
      if (s.isRepo && s.files.length) {
        const d = (await api.gitDiff(root)).diff;
        for (const l of d.split("\n")) {
          if (l.startsWith("+") && !l.startsWith("+++")) add++;
          else if (l.startsWith("-") && !l.startsWith("---")) del++;
        }
      }
      setGitInfo({ isRepo: s.isRepo, branch: s.branch ?? "", add, del, files: s.files.length });
    } catch { setGitInfo({ isRepo: false, branch: "", add: 0, del: 0, files: 0 }); }
  }, [root]);

  useEffect(() => { refreshGit(); }, [refreshGit, gitRefreshKey]);

  async function openProject(dir: string) {
    setStatus("scanning…");
    try {
      const meta = await api.scan(dir);
      setMetadata(meta);
      setStatus("indexing…");
      await api.index(dir);
      setFiles(await api.files(dir));
      setStatus("embedding…");
      await api.embed(dir);
      setMemory(await api.memory(dir).catch(() => null));
      const list = await api.sessions(dir).catch(() => []);
      if (list.length) { setSessions(list); setSession(list[0]); }
      else { const s = await api.createSession(dir, "New chat"); setSessions([s]); setSession(s); }
      setStatus("ready");
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function newSession() {
    if (!root) { setShowPicker(true); return; }
    const s = await api.createSession(root, `Chat ${sessions.length + 1}`);
    setSessions((xs) => [s, ...xs]);
    setSession(s);
  }

  async function openFile(path: string) {
    setActivePath(path);
    setShowDrawer(true);
    try { setContent((await api.file(root, path)).content); } catch { setContent(""); }
  }

  async function refreshFile(path: string) {
    if (path === activePath) { try { setContent((await api.file(root, path)).content); } catch {} }
    setFiles(await api.files(root).catch(() => files));
    setGitRefreshKey((k) => k + 1);
  }

  async function commit() {
    if (!gitInfo.isRepo) { if (confirm("Not a git repo. Initialize one?")) { await api.gitInit(root); refreshGit(); } return; }
    if (!gitInfo.files) return;
    const msg = prompt("Commit message:");
    if (!msg) return;
    try { await api.gitCommit(root, msg); setGitRefreshKey((k) => k + 1); }
    catch (e) { alert(`Commit failed: ${e instanceof Error ? e.message : e}`); }
  }

  const projectName = metadata?.name ?? (root ? root.split(/[\\/]/).pop() ?? "" : "");

  return (
    <div className="cc-app">
      <Sidebar
        tab={sidebarTab} setTab={setSidebarTab}
        projectName={projectName}
        sessions={sessions} activeSessionId={session?.id ?? null}
        onSelectSession={setSession} onNewSession={newSession}
        metadata={metadata} files={files} onOpenFile={openFile} activePath={activePath}
        onOpenProject={() => setShowPicker(true)} onSettings={() => setShowSettings(true)}
      />

      <div className="cc-main">
        <div className="cc-header">
          <span className="cc-title">{session?.title ?? "AI Coding Assistant"}</span>
          {projectName && <span className="cc-badge">{projectName}</span>}
          <span className="hint" style={{ marginLeft: 10 }}>{status}</span>
          <div style={{ flex: 1 }} />
          <button className="cc-icon" title="Toggle panel (terminal / git / plan)" onClick={() => setShowDrawer((v) => !v)}>⌗</button>
        </div>

        <div className="cc-body">
          {socketRef.current ? (
            <Chat
              root={root}
              session={session}
              socket={socketRef.current}
              providers={providers}
              projectName={projectName}
              git={gitInfo}
              onCommit={commit}
              onOpenPanel={() => setShowDrawer(true)}
              onOpenProject={() => setShowPicker(true)}
              onTitle={(title) => {
                if (!session) return;
                setSessions((xs) => xs.map((s) => (s.id === session.id ? { ...s, title } : s)));
                setSession((s) => (s ? { ...s, title } : s));
                api.renameSession(session.id, title).catch(() => {});
              }}
              onDiffApplied={refreshFile}
              onTerminal={(chunk) => { setTerminal((t) => (t + chunk).slice(-20000)); setShowDrawer(true); }}
              onGit={() => setGitRefreshKey((k) => k + 1)}
            />
          ) : (
            <div className="cc-connecting hint">Connecting to engine…</div>
          )}

          {showDrawer && (
            <div className="cc-drawer">
              <div className="cc-drawer-head">
                <span>Panel</span>
                <button className="cc-icon" onClick={() => setShowDrawer(false)}>✕</button>
              </div>
              <BottomPanel
                root={root} terminal={terminal} output={status} problems={problems}
                memory={memory} plan={plan} gitRefreshKey={gitRefreshKey}
                activePath={activePath} content={content}
              />
            </div>
          )}
        </div>
      </div>

      {showPicker && <ProjectPicker onPick={(dir) => { setShowPicker(false); setRoot(dir); }} onClose={() => setShowPicker(false)} />}
      {showSettings && <Settings onClose={() => { setShowSettings(false); api.listProviders().then(setProviders); }} />}
    </div>
  );
}
