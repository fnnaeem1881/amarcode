import { useEffect, useState } from "react";
import type { SafeProviderConfig } from "@amarcode/shared";
import { api } from "../api.js";

/** Text-to-image view — lists only image-generation models and renders results. */
export function ImageGen({ providers }: { providers: SafeProviderConfig[] }) {
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);

  const enabled = providers.filter((p) => p.enabled);

  // Load models for a provider and keep only image-generation ones.
  const loadModels = async (pid: string) => {
    setError("");
    try {
      const list = await api.listModels(pid);
      const gen = list.filter((m) => m.imageGen).map((m) => m.id);
      setModels(gen);
      setModel(gen[0] ?? "");
      if (!gen.length) setError("This provider has no image-generation models. Try OpenRouter (gemini-*-image, gpt-*-image).");
    } catch (e) { setModels([]); setError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    const first = enabled.find((p) => p.id === "openrouter") ?? enabled[0];
    if (first) { setProviderId(first.id); loadModels(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length]);

  const generate = async () => {
    if (!prompt.trim() || !model || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.generateImage(providerId, model, prompt.trim());
      setImages((xs) => [...r.images, ...xs]);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/402|credit/i.test(m) ? "Not enough provider credits for image generation (image models are pricey). Add credits at openrouter.ai/settings/credits." : m);
    } finally { setBusy(false); }
  };

  return (
    <div className="imgen">
      <div className="imgen-bar">
        <select value={providerId} onChange={(e) => { setProviderId(e.target.value); loadModels(e.target.value); }}>
          {enabled.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.length}>
          {models.length ? models.map((m) => <option key={m} value={m}>🎨 {m}</option>) : <option>no image models</option>}
        </select>
        <span className="hint">{models.length} image model{models.length === 1 ? "" : "s"}</span>
      </div>

      <div className="imgen-prompt">
        <textarea value={prompt} placeholder="Describe the image to generate…  (e.g. 'a fox reading a book, watercolor')"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }} />
        <button className="btn" onClick={generate} disabled={busy || !prompt.trim() || !model}>
          {busy ? "Generating…" : "🎨 Generate"}
        </button>
      </div>

      {error && <div className="imgen-error">⚠️ {error}</div>}

      <div className="imgen-gallery">
        {busy && <div className="imgen-skel">Generating…</div>}
        {images.map((src, i) => (
          <a key={i} href={src} download={`image-${i}.png`} className="imgen-item" title="Click to download">
            <img src={src} alt="generated" />
          </a>
        ))}
        {!images.length && !busy && <div className="hint" style={{ padding: 20 }}>Generated images appear here.</div>}
      </div>
    </div>
  );
}
