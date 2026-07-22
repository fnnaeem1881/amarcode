import { useEffect, useRef, useState, useCallback } from "react";
import type { ProjectMetadata, SafeProviderConfig, ChatSession, Plan } from "@amarcode/shared";
import { api } from "./api.js";
import { AgentSocket } from "./ws.js";
import { ProjectPicker } from "./components/ProjectPicker.js";
import { Sidebar } from "./components/Sidebar.js";
import { BottomPanel } from "./components/BottomPanel.js";
import { Chat } from "./components/Chat.js";
import { WebPreview } from "./components/WebPreview.js";
import { ImageGen } from "./components/ImageGen.js";
import { IDE } from "./components/IDE.js";
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
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);

  async function clearAllSessions() {
    await Promise.all(allSessions.map(session => api.deleteSession(session.id).catch(() => {})));
    setAllSessions([]);
    setSession(null);
  }
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"home" | "code">("home");

  const [showPicker, setShowPicker] = useState(false);
  const [pickerForNew, setPickerForNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showImageGen, setShowImageGen] = useState(false);
  const [showIDE, setShowIDE] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("theme") as "dark" | "light") || "dark");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem("sidebarCollapsed") === "1");
  useEffect(() => { localStorage.setItem("sidebarCollapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);

  const [terminal, setTerminal] = useState("");
  const [gitRefreshKey, setGitRefreshKey] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ isRepo: false, branch: "", add: 0, del: 0, files: 0 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [memory, setMemory] = useState<any>(null);
  const [problems] = useState<string[]>([]);

  const socketRef = useRef<AgentSocket | null>(null);

  // Apply + persist the light/dark theme (data-theme drives the CSS variables).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const s = new AgentSocket();
    s.connect().then(() => (socketRef.current = s)).catch(() => setStatus("engine offline"));
    api.listProviders().then(setProviders).catch(() => {});
    // Load every session across all projects (Claude-Code-style global list).
    api.allSessions().then(async (list) => {
      setAllSessions(list);
      // Open in Home with the most recent home session (or a fresh one).
      const home = list.filter((s) => (s.kind ?? "code") === "home");
      if (home.length) setSession(home[0]);
      else {
        const s = await api.createSession("", "New chat", "home");
        setAllSessions((xs) => [s, ...xs]);
        setSession(s);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (root) { localStorage.setItem("root", root); void loadProjectData(root); }
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

  // Scan/index a project directory and load its metadata + git. Auto-detects
  // an existing git repo via the git status endpoint (no init needed).
  async function loadProjectData(dir: string) {
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
      setGitRefreshKey((k) => k + 1); // auto-detect git for the new project
      setStatus("ready");
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Return to the chat view (used whenever a session/project action happens).
  function showChat() { setShowPreview(false); setShowImageGen(false); setShowIDE(false); }

  // Open a project from the picker: switch root and select/create its session.
  async function openProjectFromPicker(dir: string) {
    showChat();
    setSidebarTab("code");
    setRoot(dir);
    const forceNew = pickerForNew;
    setPickerForNew(false);
    const list = (await api.sessions(dir).catch(() => [])).filter((s) => (s.kind ?? "code") === "code");
    if (list.length && !forceNew) {
      setSession(list[0]);
    } else {
      const s = await api.createSession(dir, "New chat", "code");
      setAllSessions((xs) => [s, ...xs]);
      setSession(s);
    }
    api.allSessions().then(setAllSessions).catch(() => {});
  }

  // Selecting a session switches to its tab (home/code) and project.
  function selectSession(s: ChatSession) {
    showChat();
    setShowIDE(false);
    setSidebarTab(s.kind ?? "code");
    setSession(s);
    if ((s.kind ?? "code") === "code" && s.projectRoot && s.projectRoot !== root) setRoot(s.projectRoot);
  }

  async function newSession() {
    showChat();
    const kind = sidebarTab; // stay in the CURRENT tab
    if (kind === "code") {
      // A new coding session starts fresh — clear the old project and pick a new one.
      setRoot("");
      setMetadata(null);
      setFiles([]);
      setSession(null);
      setPickerForNew(true);
      setShowPicker(true);
      return;
    }
    // Home: create a blank chat session, reusing an existing empty one.
    if (session && (session.kind ?? "code") === "home" && session.title === "New chat") {
      const msgs = await api.messages(session.id).catch(() => []);
      if (msgs.length === 0) return;
    }
    const s = await api.createSession("", "New chat", "home");
    setAllSessions((xs) => [s, ...xs]);
    setSession(s);
  }

  async function deleteSession(id: string) {
    await api.deleteSession(id).catch(() => {});
    setAllSessions((xs) => xs.filter((s) => s.id !== id));
    if (session?.id === id) {
      const next = allSessions.find((s) => s.id !== id) ?? null;
      setSession(next);
      if (next && next.projectRoot !== root) setRoot(next.projectRoot);
    }
  }

  async function renameSession(id: string, title: string) {
    setAllSessions((xs) => xs.map((s) => (s.id === id ? { ...s, title } : s)));
    setSession((s) => (s && s.id === id ? { ...s, title } : s));
    await api.renameSession(id, title).catch(() => {});
  }

  async function deleteSessions(ids: string[]) {
    const set = new Set(ids);
    await Promise.all(ids.map((id) => api.deleteSession(id).catch(() => {})));
    setAllSessions((xs) => xs.filter((s) => !set.has(s.id)));
    if (session && set.has(session.id)) {
      const next = allSessions.find((s) => !set.has(s.id)) ?? null;
      setSession(next);
      if (next && next.projectRoot !== root) setRoot(next.projectRoot);
    }
  }

  async function openFile(path: string) {
    setActivePath(path);
    setContent("Loading…");
    try { setContent((await api.file(root, path)).content); }
    catch (e) { setContent(`// Failed to open ${path}: ${e instanceof Error ? e.message : e}`); }
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

  // Home and Code have separate session lists.
  const visibleSessions = allSessions.filter((s) => (s.kind ?? "code") === sidebarTab);

  async function switchTab(tab: "home" | "code") {
    setSidebarTab(tab);
    setShowIDE(false); setShowPreview(false); setShowImageGen(false);
    const visible = allSessions.filter((s) => (s.kind ?? "code") === tab);
    if (visible.length) {
      setSession(visible[0]);
      if (tab === "code" && visible[0].projectRoot && visible[0].projectRoot !== root) setRoot(visible[0].projectRoot);
    } else if (tab === "home") {
      // Ensure a home session exists to chat in.
      const s = await api.createSession("", "New chat", "home");
      setAllSessions((xs) => [s, ...xs]);
      setSession(s);
    } else {
      setSession(null); // Code with no sessions — user opens a project to start.
    }
  }

  const projectName = metadata?.name ?? (root ? root.split(/[\\/]/).pop() ?? "" : "");

  return (
    <div className={`cc-app ${sidebarCollapsed ? "collapsed" : ""}`}>
      <Sidebar
        tab={sidebarTab} setTab={switchTab}
        projectName={projectName}
        sessions={visibleSessions} activeSessionId={session?.id ?? null}
        onSelectSession={selectSession} onNewSession={newSession} onDeleteSession={deleteSession} onRenameSession={renameSession} onDeleteSessions={deleteSessions}
        metadata={metadata} files={files} onOpenFile={openFile} activePath={activePath}
        onOpenProject={() => { setPickerForNew(false); setShowPicker(true); }} onSettings={() => setShowSettings(true)}
        onIDE={() => { setShowIDE(true); setShowImageGen(false); setShowPreview(false); }}
        onImage={() => { setShowImageGen(true); setShowIDE(false); setShowPreview(false); }}
      />

      <div className="cc-main">
        <div className="cc-header">
          <button className="cc-icon" title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} onClick={() => setSidebarCollapsed((v) => !v)}>☰</button>
          <span className="cc-title">{session?.title ?? (sidebarTab === "home" ? "Chat" : "AI Coding Assistant")}</span>
          {sidebarTab === "code" && projectName && <span className="cc-badge">{projectName}</span>}
          {sidebarTab === "code" && <span className="hint" style={{ marginLeft: 10 }}>{status}</span>}
          <div style={{ flex: 1 }} />
          <button className="cc-icon" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          {sidebarTab === "code" && <>
            <button className={`cc-icon ${showIDE ? "on" : ""}`} title="IDE — browse & edit files" onClick={() => { setShowIDE((v) => !v); setShowImageGen(false); setShowPreview(false); }}>{showIDE ? "✕ Close IDE" : "⌨ IDE"}</button>
            <button className={`cc-icon ${showImageGen ? "on" : ""}`} title="Generate images (text-to-image)" onClick={() => { setShowImageGen((v) => !v); setShowPreview(false); setShowIDE(false); }}>🎨 Image</button>
            <button className={`cc-icon ${showPreview ? "on" : ""}`} title="Web preview (embedded browser)" onClick={() => { setShowPreview((v) => !v); setShowImageGen(false); setShowIDE(false); }}>🌐 Preview</button>
            <button className="cc-icon" title="Toggle panel (terminal / git / plan)" onClick={() => setShowDrawer((v) => !v)}>⌗</button>
          </>}
        </div>

        <div className="cc-body">
          {socketRef.current ? (
            <Chat
              root={root}
              session={session}
              sessions={visibleSessions}
              mode={sidebarTab}
              onSelectSession={selectSession}
              socket={socketRef.current}
              providers={providers}
              projectName={projectName}
              git={gitInfo}
              onCommit={commit}
              onOpenPanel={() => setShowDrawer(true)}
              onOpenProject={() => { setPickerForNew(false); setShowPicker(true); }}
              onTitle={(title) => {
                if (!session) return;
                setAllSessions((xs) => xs.map((s) => (s.id === session.id ? { ...s, title } : s)));
                setSession((s) => (s ? { ...s, title } : s));
                api.renameSession(session.id, title).catch(() => {});
              }}
              onDiffApplied={refreshFile}
              onTerminal={(chunk) => {
                setTerminal((t) => (t + chunk).slice(-20000));
                setShowDrawer(true);
                const u = detectServerUrl(chunk);
                if (u) { setPreviewUrl(u); setShowPreview(true); } // auto-open the preview
              }}
              onGit={() => setGitRefreshKey((k) => k + 1)}
              onPreview={(url) => { setPreviewUrl(url); setShowPreview(true); }}
              previewUrl={previewUrl}
              imageMode={showImageGen}
              contentOverride={
                showIDE ? <IDE root={root} files={files} activePath={activePath} content={content} onOpenFile={openFile} onSaved={() => setGitRefreshKey((k) => k + 1)} />
                : showPreview ? <WebPreview root={root} url={previewUrl} onUrlChange={setPreviewUrl} />
                : undefined
              }
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

      {showPicker && <ProjectPicker onPick={(dir) => { setShowPicker(false); openProjectFromPicker(dir); }} onClose={() => setShowPicker(false)} />}
      {showSettings && <Settings onClose={() => { setShowSettings(false); api.listProviders().then(setProviders); }} />}
    </div>
  );
}

/** Detect a dev-server URL from streamed terminal output (vite, next, CRA, etc.). */
function detectServerUrl(chunk: string): string | null {
  // Direct URL: "Local: http://localhost:5173/", "http://127.0.0.1:3000"
  const direct = chunk.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i);
  if (direct) return `http://localhost:${direct[1]}`;
  // Phrase: "listening on 3000", "listening on port 3000", "running at :8080"
  const port = chunk.match(/(?:listening|running|started|ready|serving|available)\b[^\d]{0,20}(\d{4,5})/i);
  if (port) return `http://localhost:${port[1]}`;
  return null;
}
