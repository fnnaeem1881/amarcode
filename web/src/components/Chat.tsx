import { useEffect, useRef, useState } from "react";
import type { SafeProviderConfig, ChatSession } from "@amarcode/shared";
import { AgentSocket } from "../ws.js";
import { api } from "../api.js";
import { DiffView } from "./DiffView.js";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: any; status: "running" | "ok" | "fail"; output?: string; add?: number; del?: number }
  | { kind: "diff"; unified: string }
  | { kind: "approval"; id: string; action: string; risk: string; detail?: string; resolved?: "yes" | "no" };

export function Chat({
  root, session, socket, providers, projectName, git, onCommit, onOpenPanel, onOpenProject,
  onTitle, onDiffApplied, onTerminal, onGit, onPreview,
}: {
  root: string;
  session: ChatSession | null;
  socket: AgentSocket;
  providers: SafeProviderConfig[];
  projectName: string;
  git: { isRepo: boolean; branch: string; add: number; del: number; files: number };
  onCommit: () => void;
  onOpenPanel: () => void;
  onOpenProject: () => void;
  onTitle: (title: string) => void;
  onDiffApplied: (path: string) => void;
  onTerminal: (chunk: string) => void;
  onGit: (text: string) => void;
  onPreview: (url: string) => void;
}) {
  const sessionId = session?.id ?? null;
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");      // current activity label
  const [iteration, setIteration] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds since send
  const [bypass, setBypass] = useState<boolean>(() => localStorage.getItem("bypass") === "1");
  const [providerSel, setProviderSel] = useState<string>("");
  const [modelSel, setModelSel] = useState<string>("");
  const [models, setModels] = useState<string[]>([]);
  const [activeLabel, setActiveLabel] = useState<string>("default");
  const [menuOpen, setMenuOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [items]);

  // Tick the elapsed timer while the agent is working.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => { localStorage.setItem("bypass", bypass ? "1" : "0"); }, [bypass]);

  // Hydrate the transcript when switching sessions.
  useEffect(() => {
    if (!sessionId) { setItems([]); return; }
    api.messages(sessionId).then((msgs) => {
      setItems(msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ kind: m.role as "user" | "assistant", text: m.content })));
    }).catch(() => setItems([]));
  }, [sessionId]);

  const enabledProviders = providers.filter((p) => p.enabled);

  // Initialise the selector from the configured active (routing) model.
  useEffect(() => {
    api.getRouting().then((r) => {
      const active = r.coding;
      if (active) {
        setProviderSel(active.providerId);
        setModelSel(active.model);
        setActiveLabel(active.model);
        loadModels(active.providerId, active.model);
      } else if (enabledProviders[0]) {
        setProviderSel(enabledProviders[0].id);
        loadModels(enabledProviders[0].id);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length]);

  const loadModels = async (providerId: string, keep?: string) => {
    try {
      const ms = (await api.listModels(providerId)).map((m) => m.id);
      setModels(ms);
      if (keep && !ms.includes(keep)) setModels([keep, ...ms]);
    } catch { setModels(keep ? [keep] : []); }
  };

  // The model override sent with each chat (empty → server default routing).
  const override = providerSel && modelSel ? `${providerSel}::${modelSel}` : "";

  const push = (item: Item) => setItems((xs) => [...xs, item]);
  const appendAssistant = (delta: string) =>
    setItems((xs) => {
      const last = xs[xs.length - 1];
      if (last?.kind === "assistant") return [...xs.slice(0, -1), { ...last, text: last.text + delta }];
      return [...xs, { kind: "assistant", text: delta }];
    });

  const send = () => {
    const task = input.trim();
    if (!task || busy) return;
    // Title the session from its first user message (like Claude Code).
    if (!items.some((i) => i.kind === "user")) {
      onTitle(task.length > 48 ? task.slice(0, 48) + "…" : task);
    }
    push({ kind: "user", text: task });
    setInput("");
    setBusy(true);
    setElapsed(0); setIteration(0); setStep("thinking…");

    const [providerId, model] = override.split("::");
    socket.chat(
      { sessionId: sessionId ?? undefined, root, task, override: providerId && model ? { providerId, model } : undefined },
      {
        onText: (d) => { setStep("writing…"); appendAssistant(d); },
        onIteration: (n) => { setIteration(n); setStep("thinking…"); },
        onToolStart: (call) => { setStep(`running ${call.name}…`); push({ kind: "tool", name: call.name, args: call.arguments, status: "running" }); },
        onToolResult: (call, result) => {
          const stat = diffStat(result.data?.unified);
          setItems((xs) => {
            const idx = [...xs].reverse().findIndex((i) => i.kind === "tool" && (i as any).status === "running" && (i as any).name === call.name);
            if (idx < 0) return xs;
            const real = xs.length - 1 - idx;
            const copy = xs.slice();
            copy[real] = { kind: "tool", name: call.name, args: call.arguments, status: result.ok ? "ok" : "fail", output: result.output, add: stat?.add, del: stat?.del };
            return copy;
          });
          if (call.name.startsWith("git_")) onGit(result.output);
          if (result.data?.path) onDiffApplied(result.data.path);
        },
        onToolEvent: (event) => {
          if (event.type === "terminal") onTerminal(event.payload);
          if (event.type === "diff") push({ kind: "diff", unified: event.payload.unified });
          if (event.type === "preview" && event.payload?.url) onPreview(event.payload.url);
        },
        onApproval: (req) => {
          // Bypass mode auto-approves everything except dangerous operations.
          if (bypass && req.risk !== "dangerous") {
            socket.approve(req.id, true);
            push({ kind: "approval", ...req, resolved: "yes" });
          } else {
            push({ kind: "approval", ...req });
          }
        },
        onError: (message) => { push({ kind: "assistant", text: `⚠️ ${message}` }); setBusy(false); setStep(""); },
        onDone: () => { setBusy(false); setStep(""); },
      },
    );
  };

  const resolveApproval = (id: string, approved: boolean) => {
    socket.approve(id, approved);
    setItems((xs) => xs.map((i) => (i.kind === "approval" && i.id === id ? { ...i, resolved: approved ? "yes" : "no" } : i)));
  };

  const insertSlash = (cmd: string) => { setInput((v) => (v ? v + " " : "") + cmd); setMenuOpen(false); };
  const fmtTime = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

  return (
    <div className="cc-chat">
      <div className="cc-log" ref={logRef}>
        <div className="cc-col">
          {items.length === 0 && (
            <div className="cc-empty">
              <div className="cc-empty-title">What should we build?</div>
              <div className="hint">Try: “Add JWT authentication” · “Fix the login bug” · “Convert to Docker” · “Refactor UserService”</div>
            </div>
          )}
          {items.map((it, i) => <ChatItem key={i} item={it} onResolve={resolveApproval} />)}

          {busy && (
            <div className="cc-working">
              <span className="cc-working-dot" />
              <span className="cc-working-text">Working{iteration ? ` · step ${iteration}` : ""} · {step || "…"}</span>
              <span className="cc-working-time">{fmtTime(elapsed)}</span>
              {bypass && <span className="cc-working-bypass">bypass on</span>}
            </div>
          )}
        </div>
      </div>

      <div className="cc-composer-wrap">
        <div className="cc-composer">
          <textarea
            value={input}
            placeholder="Type / for commands, or ask the assistant to build, fix, or refactor…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />

          <div className="cc-composer-bar">
            <div className="cc-plus">
              <button className="cc-icon" title="Add" onClick={() => setMenuOpen((v) => !v)}>＋</button>
              {menuOpen && (
                <div className="cc-menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => { onOpenProject(); setMenuOpen(false); }}>📁 Add folder</button>
                  <button onClick={() => { onOpenPanel(); setMenuOpen(false); }}>🗂 Open panel (files/terminal/git)</button>
                  <button onClick={() => insertSlash("/plan ")}>⌗ Slash: /plan</button>
                  <button onClick={() => insertSlash("/test")}>⌗ Slash: /test</button>
                  <button onClick={() => insertSlash("/commit")}>⌗ Slash: /commit</button>
                </div>
              )}
            </div>

            <button
              className={`cc-bypass ${bypass ? "on" : ""}`}
              onClick={() => setBypass((v) => !v)}
              title={bypass ? "Bypass permissions ON — edits & commands auto-approve (dangerous ops still ask)" : "Turn on bypass to auto-approve edits & commands"}>
              {bypass ? "⚡ Bypass on" : "🛡 Ask each time"}
            </button>

            <select className="model-pick" value={providerSel}
              onChange={(e) => { setProviderSel(e.target.value); setModelSel(""); loadModels(e.target.value); }} title="Provider">
              <option value="">provider…</option>
              {enabledProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select className="model-pick" value={modelSel}
              onChange={(e) => setModelSel(e.target.value)} title="Model" disabled={!providerSel}>
              <option value="">{models.length ? "model…" : "load models"}</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <div style={{ flex: 1 }} />

            <span className="cc-branch" title="Project · branch">
              {projectName || "—"} {git.isRepo && <b>{git.branch}</b>}
            </span>
            {git.isRepo && (git.add > 0 || git.del > 0) && (
              <span className="cc-diffstat"><span className="add">+{git.add}</span> <span className="del">−{git.del}</span></span>
            )}
            <button className="cc-commit" onClick={onCommit} disabled={!git.isRepo || !git.files} title="Commit changes">
              Commit changes
            </button>

            {busy
              ? <button className="btn ghost" onClick={() => { socket.cancel(); setBusy(false); }}>■ Stop</button>
              : <button className="cc-send" onClick={send} disabled={!root || !input.trim()}>↑</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatItem({ item, onResolve }: { item: Item; onResolve: (id: string, ok: boolean) => void }) {
  if (item.kind === "user") return <div className="msg user"><div className="who">You</div><div className="bubble">{item.text}</div></div>;
  if (item.kind === "assistant") return <div className="msg assistant"><div className="who">Assistant</div><div className="bubble">{item.text}</div></div>;
  if (item.kind === "tool") {
    const { verb, target } = toolLabel(item.name, item.args);
    return (
      <div className={`tool-line ${item.status}`}>
        <span className="tl-dot">{item.status === "running" ? "◐" : item.status === "ok" ? "●" : "✕"}</span>
        <span className="tl-verb">{verb}</span>
        {target && <span className="tl-target">{target}</span>}
        {item.add != null && item.add > 0 && <span className="tl-add">+{item.add}</span>}
        {item.del != null && item.del > 0 && <span className="tl-del">−{item.del}</span>}
        {item.output && item.status === "fail" && <div className="tl-err">{item.output.slice(0, 300)}</div>}
      </div>
    );
  }
  if (item.kind === "diff") return <DiffView unified={item.unified} />;
  if (item.kind === "approval")
    return (
      <div className={`approval ${item.risk === "dangerous" ? "dangerous" : ""}`}>
        <div><b>{item.risk === "dangerous" ? "⚠️ Approval required" : "Approval"}</b>: {item.action}</div>
        {item.detail && <DiffView unified={item.detail} />}
        {item.resolved ? (
          <div className="hint" style={{ marginTop: 6 }}>{item.resolved === "yes" ? "Approved" : "Denied"}</div>
        ) : (
          <div className="actions">
            <button className="btn" onClick={() => onResolve(item.id, true)}>Approve</button>
            <button className="btn ghost" onClick={() => onResolve(item.id, false)}>Deny</button>
          </div>
        )}
      </div>
    );
  return null;
}

/** Map a tool call to a Claude-Code-style "Verb target" label. */
function toolLabel(name: string, args: any): { verb: string; target: string } {
  const base = (p?: string) => (p ? String(p).split(/[\\/]/).pop() ?? String(p) : "");
  switch (name) {
    case "read_file": return { verb: "Read", target: base(args?.path) };
    case "write_file": return { verb: "Wrote", target: base(args?.path) };
    case "create_file": return { verb: "Created", target: base(args?.path) };
    case "edit_file": return { verb: "Edited", target: base(args?.path) };
    case "delete_file": return { verb: "Deleted", target: base(args?.path) };
    case "rename_file": return { verb: "Renamed", target: `${base(args?.from)} → ${base(args?.to)}` };
    case "move_file": return { verb: "Moved", target: `${base(args?.from)} → ${base(args?.to)}` };
    case "list_directory": return { verb: "Listed", target: args?.path ?? "." };
    case "search_text": return { verb: "Searched", target: `“${args?.query ?? ""}”` };
    case "search_symbol": return { verb: "Found symbol", target: args?.symbol ?? "" };
    case "semantic_search": return { verb: "Searched", target: `“${args?.query ?? ""}”` };
    case "run_terminal": return { verb: "Ran", target: args?.command ?? "" };
    case "run_tests": return { verb: "Ran tests", target: args?.command ?? "" };
    case "run_build": return { verb: "Built", target: args?.command ?? "" };
    case "git_status": return { verb: "Git status", target: "" };
    case "git_diff": return { verb: "Git diff", target: args?.path ?? "" };
    case "git_commit": return { verb: "Committed", target: `“${args?.message ?? ""}”` };
    case "git_branch": return { verb: "Branch", target: args?.name ?? "" };
    case "git_checkout": return { verb: "Checked out", target: args?.ref ?? "" };
    default: return { verb: name, target: base(args?.path) };
  }
}

/** Count added/removed lines from a unified diff. */
function diffStat(unified?: string): { add: number; del: number } | undefined {
  if (!unified || typeof unified !== "string") return undefined;
  let add = 0, del = 0;
  for (const line of unified.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) add++;
    else if (line.startsWith("-") && !line.startsWith("---")) del++;
  }
  return { add, del };
}
