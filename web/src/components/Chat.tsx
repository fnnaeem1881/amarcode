import { useEffect, useRef, useState } from "react";
import type { SafeProviderConfig } from "@amarcode/shared";
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
  root, sessionId, socket, providers, onDiffApplied, onTerminal, onGit,
}: {
  root: string;
  sessionId: string | null;
  socket: AgentSocket;
  providers: SafeProviderConfig[];
  onDiffApplied: (path: string) => void;
  onTerminal: (chunk: string) => void;
  onGit: (text: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<string>(""); // "providerId::model"
  const [models, setModels] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [items]);

  const enabledProviders = providers.filter((p) => p.enabled);

  const loadModels = async (providerId: string) => {
    try { setModels((await api.listModels(providerId)).map((m) => m.id)); } catch { setModels([]); }
  };

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
    push({ kind: "user", text: task });
    setInput("");
    setBusy(true);

    const [providerId, model] = override.split("::");
    socket.chat(
      { sessionId: sessionId ?? undefined, root, task, override: providerId && model ? { providerId, model } : undefined },
      {
        onText: appendAssistant,
        onToolStart: (call) => push({ kind: "tool", name: call.name, args: call.arguments, status: "running" }),
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
        },
        onApproval: (req) => push({ kind: "approval", ...req }),
        onError: (message) => { push({ kind: "assistant", text: `⚠️ ${message}` }); setBusy(false); },
        onDone: () => setBusy(false),
      },
    );
  };

  const resolveApproval = (id: string, approved: boolean) => {
    socket.approve(id, approved);
    setItems((xs) => xs.map((i) => (i.kind === "approval" && i.id === id ? { ...i, resolved: approved ? "yes" : "no" } : i)));
  };

  return (
    <div className="pane chat">
      <div className="chat-header">
        <b style={{ color: "var(--green)" }}>AI Assistant</b>
        <select
          value={override}
          onChange={(e) => { setOverride(e.target.value); const pid = e.target.value.split("::")[0]; if (pid) loadModels(pid); }}
          style={{ marginLeft: "auto", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 6px", maxWidth: 150 }}
          title="Per-chat model override"
        >
          <option value="">Default routing</option>
          {enabledProviders.map((p) => <option key={p.id} value={`${p.id}::`}>{p.label}</option>)}
          {models.map((m) => <option key={m} value={`${override.split("::")[0]}::${m}`}>{m}</option>)}
        </select>
      </div>

      <div className="chat-log" ref={logRef}>
        {items.length === 0 && (
          <div className="hint" style={{ padding: 8 }}>
            Try: “Add JWT authentication”, “Fix the login bug”, “Convert project to Docker”, “Refactor UserService”.
          </div>
        )}
        {items.map((it, i) => <ChatItem key={i} item={it} onResolve={resolveApproval} />)}
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          placeholder="Ask the assistant to build, fix, or refactor…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
        />
        <div className="actions">
          <button className="btn" onClick={send} disabled={busy || !root}>{busy ? "Working…" : "Send"}</button>
          {busy && <button className="btn ghost" onClick={() => { socket.cancel(); setBusy(false); }}>Stop</button>}
          <span className="hint" style={{ marginLeft: "auto", alignSelf: "center" }}>⌘/Ctrl + Enter</span>
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
