import { useEffect, useRef, useState } from "react";
import type { SafeProviderConfig, ChatSession } from "@amarcode/shared";
import { AgentSocket } from "../ws.js";
import { api } from "../api.js";
import { DiffView } from "./DiffView.js";

type Item =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: any; status: "running" | "ok" | "fail"; output?: string; add?: number; del?: number }
  | { kind: "diff"; unified: string }
  | { kind: "screenshot"; image: string; url: string }
  | { kind: "images"; images: string[] }
  | { kind: "approval"; id: string; action: string; risk: string; detail?: string; resolved?: "yes" | "no" };

interface ImgModel { engine: string; id: string; label: string; needsKey?: string; local?: boolean; video?: boolean }

export function Chat({
  root, session, sessions, mode, onSelectSession, socket, providers, projectName, git, onCommit, onOpenPanel, onOpenProject,
  onTitle, onDiffApplied, onTerminal, onGit, onPreview, previewUrl, contentOverride, imageMode, videoMode, onMarkMode,
}: {
  root: string;
  session: ChatSession | null;
  sessions: ChatSession[];
  mode: "home" | "code";
  onSelectSession: (s: ChatSession) => void;
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
  previewUrl: string;
  contentOverride?: React.ReactNode;
  imageMode?: boolean;
  videoMode?: boolean; // within imageMode: show 🎬 video models instead of 🎨 image ones
  onMarkMode?: (mode: "image" | "video") => void;
}) {
  const sessionId = session?.id ?? null;
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");      // current activity label
  const [iteration, setIteration] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds since send
  const [tokens, setTokens] = useState(0);   // cumulative tokens this turn
  const [bypass, setBypass] = useState<boolean>(() => localStorage.getItem("bypass") === "1");
  const [lite, setLite] = useState<boolean>(() => localStorage.getItem("lite") === "1");
  const [providerSel, setProviderSel] = useState<string>("");
  const [modelSel, setModelSel] = useState<string>("");
  const [models, setModels] = useState<string[]>([]);
  const [visionSet, setVisionSet] = useState<Set<string>>(new Set());
  const [activeLabel, setActiveLabel] = useState<string>("default");
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]); // image data URIs
  const [imgEngines, setImgEngines] = useState<ImgModel[]>([]);
  const [imgSel, setImgSel] = useState<string>(""); // "engine::id"
  const [imgSetup, setImgSetup] = useState(false);  // ⚙ engine tokens/URLs popover
  const logRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load free image/video engines when in image mode.
  useEffect(() => {
    if (!imageMode || imgEngines.length) return;
    api.imageEngines().then(setImgEngines).catch(() => {});
  }, [imageMode, imgEngines.length]);

  // Keep the selection matching the mode: 🎬 models in video, 🎨 models otherwise.
  useEffect(() => {
    if (!imageMode || !imgEngines.length) return;
    const pool = imgEngines.filter((m) => (videoMode ? m.video : !m.video));
    if (pool.length && !pool.some((m) => `${m.engine}::${m.id}` === imgSel)) {
      setImgSel(`${pool[0].engine}::${pool[0].id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageMode, videoMode, imgEngines]);

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
  useEffect(() => { localStorage.setItem("lite", lite ? "1" : "0"); }, [lite]);

  // Hydrate the transcript when switching sessions. Clear immediately so the
  // previous session's messages never linger while the new ones load.
  useEffect(() => {
    setItems([]);
    if (!sessionId) return;
    api.messages(sessionId).then((msgs) => {
      setItems(msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m): Item => {
          // A stored message carrying images is a generated-image turn.
          if (m.role === "assistant" && m.images?.length) return { kind: "images", images: m.images };
          if (m.role === "user") return { kind: "user", text: m.content, images: m.images };
          return { kind: "assistant", text: m.content };
        }));
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
      const list = await api.listModels(providerId);
      const ms = list.map((m) => m.id);
      setModels(keep && !ms.includes(keep) ? [keep, ...ms] : ms);
      setVisionSet(new Set(list.filter((m) => m.vision).map((m) => m.id)));
    } catch { setModels(keep ? [keep] : []); }
  };

  // Effective model + whether it can read images.
  const effectiveModel = modelSel || activeLabel;
  const modelHasVision = (id: string) => visionSet.has(id) || looksVision(id);
  const imageWarn = attachments.length > 0 && effectiveModel && effectiveModel !== "default" && !modelHasVision(effectiveModel);
  const firstVisionModel = models.find((m) => modelHasVision(m));

  // The model override sent with each chat (empty → server default routing).
  const override = providerSel && modelSel ? `${providerSel}::${modelSel}` : "";

  const push = (item: Item) => setItems((xs) => [...xs, item]);
  const appendAssistant = (delta: string) =>
    setItems((xs) => {
      const last = xs[xs.length - 1];
      if (last?.kind === "assistant") return [...xs.slice(0, -1), { ...last, text: last.text + delta }];
      return [...xs, { kind: "assistant", text: delta }];
    });

  // Image attachment helpers (paste + upload).
  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => setAttachments((a) => [...a, String(reader.result)]);
      reader.readAsDataURL(f);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  // Shrink a data-URI image so editing engines get a manageable payload.
  const downscale = (src: string, max = 768): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && src.length < 400_000) return resolve(src);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });

  // Image mode: the composer prompt generates an image — or, when a base image
  // is attached (upload/paste/“✎ Edit”), modifies it per the instruction.
  const generateImage = async () => {
    const p = input.trim();
    if (!p || busy || !imgSel) return;
    const [engine, model] = imgSel.split("::");
    const isVideo = imgEngines.some((m) => m.engine === engine && m.id === model && m.video);
    const baseImg = !isVideo && attachments[0] ? await downscale(attachments[0]) : undefined;
    if (!items.some((i) => i.kind === "user")) onTitle(p.length > 48 ? p.slice(0, 48) + "…" : p);
    onMarkMode?.(isVideo ? "video" : "image"); // remember this is an image/video session
    push({ kind: "user", text: p, images: baseImg ? [baseImg] : undefined });
    setInput("");
    setAttachments([]);
    setBusy(true); setStep(isVideo ? "generating video… (can take minutes)" : baseImg ? "editing image…" : "generating image…"); setElapsed(0);
    // Persist the prompt now so the turn survives even if generation fails or
    // the user navigates away mid-render.
    if (sessionId) api.addMessage(sessionId, { role: "user", content: p, images: baseImg ? [baseImg] : undefined }).catch(() => {});
    try {
      const r = await api.generateImageFree(engine, model, p, baseImg);
      push({ kind: "images", images: r.images });
      if (sessionId) api.addMessage(sessionId, { role: "assistant", content: "", images: r.images }).catch(() => {});
    } catch (e) {
      push({ kind: "assistant", text: `⚠️ ${e instanceof Error ? e.message : e}` });
    } finally { setBusy(false); setStep(""); }
  };

  const send = () => {
    if (imageMode) { void generateImage(); return; }
    const task = input.trim();
    if ((!task && attachments.length === 0) || busy) return;
    // Title the session from its first user message (like Claude Code).
    if (!items.some((i) => i.kind === "user")) {
      onTitle(task.length > 48 ? task.slice(0, 48) + "…" : task);
    }
    const images = attachments;
    push({ kind: "user", text: task, images });
    setInput("");
    setAttachments([]);
    setBusy(true);
    setElapsed(0); setIteration(0); setStep("thinking…"); setTokens(0);

    const [providerId, model] = override.split("::");
    socket.chat(
      { sessionId: sessionId ?? undefined, root, task, override: providerId && model ? { providerId, model } : undefined, previewUrl: previewUrl || undefined, lite, images: images.length ? images : undefined, mode },
      {
        onText: (d) => { setStep("writing…"); appendAssistant(d); },
        onIteration: (n) => { setIteration(n); setStep("thinking…"); },
        onUsage: (u) => setTokens(u.totalTokens),
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
          if (event.type === "screenshot" && event.payload?.image) push({ kind: "screenshot", image: event.payload.image, url: event.payload.url });
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
  const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

  const hero = items.length === 0 && !busy && !imageMode;
  const selIsVideo = imgEngines.some((m) => `${m.engine}::${m.id}` === imgSel && m.video);
  const userName = localStorage.getItem("userName") || "";
  const fmtWhen = (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  };
  const projOf = (r: string) => r.split(/[\\/]/).filter(Boolean).pop() ?? r;

  const renderComposer = () => (
      <div className="cc-composer-wrap">
        {mode === "code" && (
          <div className="cc-ctxchips">
            <button className="cc-chip" onClick={onOpenProject} title="Change project">📁 {projectName || "Local"}</button>
            {git.isRepo && <span className="cc-chip"><span className="ic">⎇</span> {git.branch}</span>}
            {git.isRepo && (git.add > 0 || git.del > 0) && <span className="cc-chip"><span className="add">+{git.add}</span> <span className="del">−{git.del}</span></span>}
          </div>
        )}
        <div className="cc-composer">
          {attachments.length > 0 && (
            <div className="cc-attachments">
              {attachments.map((src, i) => (
                <div className="cc-thumb" key={i}>
                  <img src={src} alt="attachment" />
                  <button title="Remove" onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          {imageWarn && (
            <div className="cc-imgwarn">
              ⚠️ <b>{effectiveModel}</b> can't read images.
              {firstVisionModel
                ? <button onClick={() => setModelSel(firstVisionModel!)}>Switch to {firstVisionModel} 👁</button>
                : <span> Pick a vision model (e.g. gpt-4o, claude, gemini) below.</span>}
            </div>
          )}
          <textarea
            value={input}
            placeholder={imageMode
              ? (selIsVideo
                ? "Describe a short video to generate… (a few seconds; can take minutes)"
                : attachments.length
                ? "Describe how to edit this image… (e.g. make the sky purple, remove the car)"
                : "Describe an image to generate… (or upload/paste one to edit)")
              : "Describe a task or ask a question…"}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

          {imageMode && imgSetup && <ImgSetup onClose={() => setImgSetup(false)} />}

          <div className="cc-composer-bar">
            <div className="cc-plus">
              <button className="cc-icon" title="Add" onClick={() => setMenuOpen((v) => !v)}>＋</button>
              {menuOpen && (
                <div className="cc-menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }}>🖼 Add image / photo</button>
                  {mode === "code" && <>
                    <button onClick={() => { onOpenProject(); setMenuOpen(false); }}>📁 Add folder</button>
                    <button onClick={() => { onOpenPanel(); setMenuOpen(false); }}>🗂 Open panel (files/terminal/git)</button>
                    <button onClick={() => insertSlash("/plan ")}>⌗ Slash: /plan</button>
                    <button onClick={() => insertSlash("/test")}>⌗ Slash: /test</button>
                    <button onClick={() => insertSlash("/commit")}>⌗ Slash: /commit</button>
                  </>}
                </div>
              )}
            </div>

            {!videoMode && <button className="cc-icon" title={imageMode ? "Upload an image to edit/modify" : "Attach image"} onClick={() => fileInputRef.current?.click()}>🖼</button>}

            {imageMode && (
              <>
                <select className="model-pick" style={{ maxWidth: 260 }} value={imgSel} onChange={(e) => setImgSel(e.target.value)} title={videoMode ? "Video model" : "Image model"}>
                  {imgEngines.filter((m) => (videoMode ? m.video : !m.video)).map((m) => (
                    <option key={`${m.engine}::${m.id}`} value={`${m.engine}::${m.id}`}>{videoMode ? "" : "🎨 "}{m.label}</option>
                  ))}
                </select>
                <button className="cc-icon" title="Engine setup (free tokens / local URLs)" onClick={() => setImgSetup((v) => !v)}>⚙</button>
              </>
            )}

            {mode === "code" && !imageMode && <>
              <button
                className={`cc-bypass ${bypass ? "on" : ""}`}
                onClick={() => setBypass((v) => !v)}
                title={bypass ? "Bypass permissions ON — edits & commands auto-approve (dangerous ops still ask)" : "Turn on bypass to auto-approve edits & commands"}>
                {bypass ? "⚡ Bypass on" : "🛡 Ask each time"}
              </button>
              <button
                className={`cc-bypass ${lite ? "on" : ""}`}
                onClick={() => setLite((v) => !v)}
                title={lite ? "Lite mode ON — sends a compact repo map instead of full files (fewer tokens; agent reads files on demand)" : "Turn on Lite to save tokens (compact context)"}>
                {lite ? "🪶 Lite on" : "🪶 Lite"}
              </button>
            </>}

            {!imageMode && <>
              <select className="model-pick" value={providerSel}
                onChange={(e) => { setProviderSel(e.target.value); setModelSel(""); loadModels(e.target.value); }} title="Provider">
                <option value="">provider…</option>
                {enabledProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select className="model-pick" value={modelSel}
                onChange={(e) => setModelSel(e.target.value)} title="Model" disabled={!providerSel}>
                <option value="">{models.length ? "model…" : "load models"}</option>
                {models.map((m) => <option key={m} value={m}>{modelHasVision(m) ? "👁 " : ""}{m}</option>)}
              </select>
            </>}

            <div style={{ flex: 1 }} />

            {mode === "code" && <>
              <span className="cc-branch" title="Project · branch">
                {projectName || "—"} {git.isRepo && <b>{git.branch}</b>}
              </span>
              {git.isRepo && (git.add > 0 || git.del > 0) && (
                <span className="cc-diffstat"><span className="add">+{git.add}</span> <span className="del">−{git.del}</span></span>
              )}
              <button className="cc-commit" onClick={onCommit} disabled={!git.isRepo || !git.files} title="Commit changes">
                Commit changes
              </button>
            </>}

            {busy
              ? <button className="btn ghost" onClick={() => { socket.cancel(); setBusy(false); }}>■ Stop</button>
              : <button className="cc-send" onClick={send} disabled={(mode === "code" && !imageMode && !root) || !input.trim()}>↑</button>}
          </div>
        </div>
      </div>
  );

  if (contentOverride) {
    return (
      <div className="cc-chat">
        <div className="cc-override">{contentOverride}</div>
        {renderComposer()}
      </div>
    );
  }

  return (
    <div className={`cc-chat ${hero ? "dash" : ""}`}>
      {hero ? (
        <div className="cc-dash">
          <div className="cc-dash-head">
            <div className="cc-dash-title"><span className="star"></span> Welcome back{userName ? `, ${userName}` : ""}</div>
          </div>
          <div className="cc-dash-section">Sessions</div>
          <div className="cc-dash-list">
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} className={`cc-scard ${session?.id === s.id ? "active" : ""}`} onClick={() => onSelectSession(s)}>
                <span className="cc-scard-ic">{s.mode === "image" ? "🎨" : s.mode === "video" ? "🎬" : mode === "code" ? "📁" : "💬"}</span>
                <div className="cc-scard-main">
                  <div className="cc-scard-top">
                    <span className="cc-scard-title">{s.title}</span>
                    <span className="cc-scard-when">{fmtWhen(s.updatedAt)}</span>
                  </div>
                  <div className="cc-scard-sub">
                    {s.preview ?? (projOf(s.projectRoot) || "empty chat")}
                    {s.msgCount != null && s.msgCount > 0 && <span className="cc-scard-count"> · {s.msgCount} msg</span>}
                  </div>
                </div>
                <span className="cc-scard-arrow">›</span>
              </div>
            ))}
            {!sessions.length && <div className="hint" style={{ padding: 12 }}>No sessions yet — describe a task below to start.</div>}
          </div>
        </div>
      ) : null}
      <div className="cc-log" ref={logRef} style={hero ? { flex: "0 0 auto", display: "none" } : undefined}>
        <div className="cc-col">
          {imageMode && items.length === 0 && !busy && (videoMode ? (
            <div className="cc-empty"><div className="cc-empty-title">🎬 Generate a video</div><div className="hint">Describe a short clip below and press Enter — e.g. “a cat walking in the rain”. Needs a free Hugging Face token or local ComfyUI (⚙). Takes a few minutes.</div></div>
          ) : (
            <div className="cc-empty"><div className="cc-empty-title">🎨 Generate or edit an image</div><div className="hint">Type a description below and press Enter — or upload/paste a photo (🖼) and tell it what to change. After a result, hit ✎ Edit on it to keep adjusting.</div></div>
          ))}
          {items.map((it, i) => (
            <ChatItem key={i} item={it} onResolve={resolveApproval}
              onEditImage={imageMode && !videoMode ? (src) => { setAttachments([src]); } : undefined} />
          ))}

          {busy && (
            <div className="cc-working">
              <span className="cc-working-dot" />
              <span className="cc-working-text">Working{iteration ? ` · step ${iteration}` : ""} · {step || "…"}</span>
              <span className="cc-working-time">{fmtTime(elapsed)}</span>
              {tokens > 0 && <span className="cc-working-tokens">{fmtTokens(tokens)} tokens</span>}
              {bypass && <span className="cc-working-bypass">bypass on</span>}
            </div>
          )}
          {!busy && tokens > 0 && items.length > 0 && (
            <div className="cc-turnstat">✓ {fmtTime(elapsed)} · {fmtTokens(tokens)} tokens</div>
          )}
        </div>
      </div>

      {renderComposer()}
    </div>
  );
}

/** ⚙ Free-engine setup: tokens (no credit card) + local server URLs. */
function ImgSetup({ onClose }: { onClose: () => void }) {
  const keys = [
    { key: "pollinationsToken", label: "Pollinations token", hint: "free — enter.pollinations.ai (needed for image editing)" },
    { key: "hfToken", label: "Hugging Face token", hint: "free — huggingface.co/settings/tokens" },
    { key: "a1111Url", label: "AUTOMATIC1111 / Forge URL", hint: "local — default http://127.0.0.1:7860" },
    { key: "comfyUrl", label: "ComfyUI URL", hint: "local — default http://127.0.0.1:8188" },
    { key: "comfyVideoWorkflow", label: "ComfyUI video workflow (JSON)", hint: 'export any T2V flow in API format, put {PROMPT} as the prompt text', multi: true },
  ];
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const k of keys) api.getSetting(k.key).then((r) => setVals((v) => ({ ...v, [k.key]: r.value ?? "" }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="img-setup">
      <div className="img-setup-head">
        <b>Image engine setup</b> <span className="hint">all free — no credit card</span>
        <div style={{ flex: 1 }} />
        <button className="cc-icon" onClick={onClose}>✕</button>
      </div>
      {keys.map((k) => (
        <label key={k.key} className="img-setup-row">
          <span>{k.label} <span className="hint">· {k.hint}</span></span>
          {(k as any).multi ? (
            <textarea rows={3} value={vals[k.key] ?? ""} placeholder={k.hint}
              onChange={(e) => setVals((v) => ({ ...v, [k.key]: e.target.value }))}
              onBlur={(e) => api.setSetting(k.key, e.target.value.trim()).catch(() => {})} />
          ) : (
            <input type={k.key.endsWith("Token") ? "password" : "text"} value={vals[k.key] ?? ""}
              placeholder={k.hint}
              onChange={(e) => setVals((v) => ({ ...v, [k.key]: e.target.value }))}
              onBlur={(e) => api.setSetting(k.key, e.target.value.trim()).catch(() => {})} />
          )}
        </label>
      ))}
    </div>
  );
}

function ChatItem({ item, onResolve, onEditImage }: { item: Item; onResolve: (id: string, ok: boolean) => void; onEditImage?: (src: string) => void }) {
  if (item.kind === "user") return (
    <div className="msg user">
      <div className="who">You</div>
      <div className="bubble">
        {item.images?.length ? <div className="msg-imgs">{item.images.map((src, i) => <img key={i} src={src} alt="attachment" />)}</div> : null}
        {item.text}
      </div>
    </div>
  );
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
  if (item.kind === "screenshot")
    return (
      <div className="shot">
        <div className="shot-cap">🖥 {item.url}</div>
        <img src={item.image} alt="browser screenshot" />
      </div>
    );
  if (item.kind === "images")
    return (
      <div className="msg assistant">
        <div className="who">Image</div>
        <div className="gen-imgs">
          {item.images.map((src, i) => src.startsWith("data:video") ? (
            <div className="gen-img" key={i}>
              <video src={src} controls loop muted playsInline />
              <a className="gen-dl" href={src} download={`video-${i}.mp4`} title="Download video">⬇</a>
            </div>
          ) : (
            <div className="gen-img" key={i}>
              <a href={src} download={`image-${i}.png`} title="Click to download"><img src={src} alt="generated" /></a>
              {onEditImage && (
                <button className="gen-edit" title="Edit this image — it becomes the base; type an instruction below"
                  onClick={() => onEditImage(src)}>✎ Edit</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
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
/** Heuristic: does a model id look vision-capable? (fallback when metadata absent) */
function looksVision(id: string): boolean {
  return /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o[134]\b|claude-3|claude-(?:sonnet|opus|haiku)|gemini|llava|vision|-vl\b|pixtral|qwen.*vl|internvl|molmo|phi-4|llama-3\.2-(?:11|90)b/i.test(id);
}

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
