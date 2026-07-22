import { useEffect, useState } from "react";
import type { SafeProviderConfig } from "@amarcode/shared";
import { api } from "../api.js";

interface FreeModel { engine: string; id: string; label: string; needsKey?: string; local?: boolean }

/** Text-to-image — free engines (Pollinations/HF/local) + provider image models. */
export function ImageGen({ providers }: { providers: SafeProviderConfig[] }) {
  const [free, setFree] = useState<FreeModel[]>([]);
  const [sel, setSel] = useState<string>("");        // "engine::id"
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);

  // Settings for the engines that need config.
  const [hfToken, setHfToken] = useState("");
  const [a1111Url, setA1111Url] = useState("");
  const [comfyUrl, setComfyUrl] = useState("");
  const [showCfg, setShowCfg] = useState(false);

  useEffect(() => {
    api.imageEngines().then((list) => {
      setFree(list);
      if (list.length) setSel(`${list[0].engine}::${list[0].id}`);
    }).catch(() => {});
    api.getSetting("hfToken").then((r) => setHfToken(r.value || "")).catch(() => {});
    api.getSetting("a1111Url").then((r) => setA1111Url(r.value || "")).catch(() => {});
    api.getSetting("comfyUrl").then((r) => setComfyUrl(r.value || "")).catch(() => {});
  }, []);

  const [engine, modelId] = sel.split("::");
  const current = free.find((m) => `${m.engine}::${m.id}` === sel);

  const generate = async () => {
    if (!prompt.trim() || !sel || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.generateImageFree(engine, modelId, prompt.trim());
      setImages((xs) => [...r.images, ...xs]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const saveCfg = () => {
    api.setSetting("hfToken", hfToken).catch(() => {});
    api.setSetting("a1111Url", a1111Url).catch(() => {});
    api.setSetting("comfyUrl", comfyUrl).catch(() => {});
    setShowCfg(false);
  };

  // Group models by engine for the dropdown.
  const groups: Record<string, FreeModel[]> = {};
  for (const m of free) (groups[m.engine] ??= []).push(m);
  const engineLabel: Record<string, string> = {
    pollinations: "Pollinations — free, no key ✨",
    huggingface: "Hugging Face — free token",
    a1111: "AUTOMATIC1111 / Forge (local)",
    comfyui: "ComfyUI (local)",
  };

  return (
    <div className="imgen">
      <div className="imgen-bar">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {Object.entries(groups).map(([eng, ms]) => (
            <optgroup key={eng} label={engineLabel[eng] ?? eng}>
              {ms.map((m) => <option key={`${m.engine}::${m.id}`} value={`${m.engine}::${m.id}`}>🎨 {m.label}</option>)}
            </optgroup>
          ))}
        </select>
        {engine === "pollinations" && <span className="imgen-free">FREE · no signup</span>}
        {current?.needsKey === "hf" && !hfToken && <span className="imgen-warn">needs a free HF token →</span>}
        {(current?.needsKey || current?.local) && <button className="btn ghost sm" onClick={() => setShowCfg((v) => !v)}>⚙ Setup</button>}
      </div>

      {showCfg && (
        <div className="imgen-cfg">
          <label>Hugging Face token <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">(get one free — no card)</a></label>
          <input type="password" placeholder="hf_…" value={hfToken} onChange={(e) => setHfToken(e.target.value)} />
          <label>AUTOMATIC1111 / Forge URL</label>
          <input placeholder="http://127.0.0.1:7860" value={a1111Url} onChange={(e) => setA1111Url(e.target.value)} />
          <label>ComfyUI URL</label>
          <input placeholder="http://127.0.0.1:8188" value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)} />
          <button className="btn" onClick={saveCfg}>Save</button>
        </div>
      )}

      <div className="imgen-prompt">
        <textarea value={prompt} placeholder="Describe the image…  (e.g. 'a fox reading a book, watercolor')"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }} />
        <button className="btn" onClick={generate} disabled={busy || !prompt.trim() || !sel}>{busy ? "Generating…" : "🎨 Generate"}</button>
      </div>

      {error && <div className="imgen-error">⚠️ {error}</div>}

      <div className="imgen-gallery">
        {busy && <div className="imgen-skel">Generating…</div>}
        {images.map((src, i) => (
          <a key={i} href={src} download={`image-${i}.png`} className="imgen-item" title="Click to download"><img src={src} alt="generated" /></a>
        ))}
        {!images.length && !busy && <div className="hint" style={{ padding: 20 }}>Generated images appear here. Pollinations works instantly with no key.</div>}
      </div>
    </div>
  );
}
