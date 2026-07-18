import { useEffect, useRef, useState } from "react";
import type { ProjectMetadata, SafeProviderConfig, ChatSession, Plan } from "@amarcode/shared";
import { api } from "./api.js";
import { AgentSocket } from "./ws.js";
import { ProjectPicker } from "./components/ProjectPicker.js";
import { Explorer } from "./components/Explorer.js";
import { Editor } from "./components/Editor.js";
import { BottomPanel } from "./components/BottomPanel.js";
import { Chat } from "./components/Chat.js";
import { Settings } from "./components/Settings.js";

export function App() {
  const [root, setRoot] = useState<string>(() => localStorage.getItem("root") ?? "");
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [files, setFiles] = useState<{ path: string; language: string; size: number; symbols: number; importance: number }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");

  const [providers, setProviders] = useState<SafeProviderConfig[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [terminal, setTerminal] = useState("");
  const [git, setGit] = useState("");
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
  }, [root]);

  async function openProject(dir: string) {
    setStatus("scanning…");
    try {
      const meta = await api.scan(dir);
      setMetadata(meta);
      setStatus("indexing…");
      await api.index(dir);
      setFiles(await api.files(dir));
      setStatus("embedding (background)…");
      await api.embed(dir);
      setMemory(await api.memory(dir).catch(() => null));
      const s = await api.createSession(dir, "New chat");
      setSession(s);
      setStatus("ready");
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function openFile(path: string) {
    setActivePath(path);
    try { setContent((await api.file(root, path)).content); } catch { setContent(""); }
  }

  async function refreshFile(path: string) {
    if (path === activePath) { try { setContent((await api.file(root, path)).content); } catch {} }
    setFiles(await api.files(root).catch(() => files));
  }

  async function makePlan() {
    if (!session) return;
    const task = prompt("Describe the task to plan:");
    if (!task) return;
    setStatus("planning…");
    try { setPlan(await api.plan(session.id, root, task)); setStatus("plan ready"); }
    catch (e) { setStatus(`plan failed: ${e instanceof Error ? e.message : e}`); }
  }

  const enabledCount = providers.filter((p) => p.enabled && p.hasApiKey).length + providers.filter((p) => p.enabled && (p.kind === "ollama" || p.kind === "lmstudio")).length;

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">◆ AmarCode</span>
        <button onClick={() => setShowPicker(true)}>📂 {root ? shorten(root) : "Open project"}</button>
        {root && <button onClick={() => openProject(root)}>↻ Rescan</button>}
        {root && <button onClick={makePlan}>◧ Plan</button>}
        <div className="spacer" />
        <span className="pill">{status || "idle"}</span>
        <span className="pill">{files.length} files</span>
        <span className="pill">{enabledCount} providers ready</span>
        <button onClick={() => setShowSettings(true)}>⚙ AI Settings</button>
      </div>

      <div className="main">
        <Explorer metadata={metadata} files={files} activePath={activePath} onOpen={openFile} />

        <div className="center">
          <Editor path={activePath} content={content} />
          <BottomPanel terminal={terminal} output={status} git={git} problems={problems} memory={memory} plan={plan} />
        </div>

        {socketRef.current ? (
          <Chat
            root={root}
            sessionId={session?.id ?? null}
            socket={socketRef.current}
            providers={providers}
            onDiffApplied={refreshFile}
            onTerminal={(chunk) => setTerminal((t) => (t + chunk).slice(-20000))}
            onGit={setGit}
          />
        ) : (
          <div className="pane chat"><div className="hint" style={{ padding: 16 }}>Connecting to engine…</div></div>
        )}
      </div>

      {showPicker && <ProjectPicker onPick={(dir) => { setShowPicker(false); setRoot(dir); }} onClose={() => setShowPicker(false)} />}
      {showSettings && <Settings onClose={() => { setShowSettings(false); api.listProviders().then(setProviders); }} />}
    </div>
  );
}

function shorten(p: string): string {
  return p.length > 32 ? "…" + p.slice(-30) : p;
}
