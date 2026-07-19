import { useEffect, useState } from "react";
import type { ProviderKind, SafeProviderConfig, ModelRouting } from "@amarcode/shared";
import { api } from "../api.js";

const KINDS: { id: ProviderKind; label: string; needsKey: boolean; hint?: string }[] = [
  { id: "openrouter", label: "OpenRouter", needsKey: true, hint: "sk-or-v1-…" },
  { id: "openai", label: "OpenAI", needsKey: true, hint: "sk-…" },
  { id: "anthropic", label: "Anthropic (Claude)", needsKey: true, hint: "sk-ant-…" },
  { id: "gemini", label: "Google Gemini", needsKey: true, hint: "AIza…" },
  { id: "groq", label: "Groq", needsKey: true },
  { id: "deepseek", label: "DeepSeek", needsKey: true },
  { id: "mistral", label: "Mistral AI", needsKey: true },
  { id: "together", label: "Together AI", needsKey: true },
  { id: "fireworks", label: "Fireworks AI", needsKey: true },
  { id: "ollama", label: "Ollama (Local)", needsKey: false },
  { id: "lmstudio", label: "LM Studio (Local)", needsKey: false },
  { id: "vllm", label: "vLLM (Local)", needsKey: false },
  { id: "azure-openai", label: "Azure OpenAI", needsKey: true },
  { id: "openai-compatible", label: "OpenAI-Compatible", needsKey: true },
];

type TestState = { ok?: boolean; latencyMs?: number; error?: string; models?: string[]; testing?: boolean };

export function Settings({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<SafeProviderConfig[]>([]);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [routing, setRouting] = useState<ModelRouting>({});
  const [newKind, setNewKind] = useState<ProviderKind>("openrouter");
  const [maxTokens, setMaxTokens] = useState<number>(1024);

  const refresh = async () => {
    setProviders(await api.listProviders());
    setRouting(await api.getRouting());
    setMaxTokens((await api.getSetting("maxOutputTokens").catch(() => ({ value: 1024 }))).value ?? 1024);
  };
  useEffect(() => { refresh(); }, []);

  const active = routing.coding;
  const activeLabel = active
    ? `${providers.find((p) => p.id === active.providerId)?.label ?? active.providerId} · ${active.model}`
    : "not set — add a key below";

  const addProvider = async () => {
    await api.saveProvider({ kind: newKind } as any);
    await refresh();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ AI Settings</h2>
        <div className="body">
          <div className="active-banner">
            <div>
              <div className="hint">Active model (used by the assistant)</div>
              <div className="active-model">{activeLabel}</div>
            </div>
          </div>

          <div className="max-tokens-row">
            <label>Max output tokens per request</label>
            <input type="number" min={128} max={32000} step={64} value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              onBlur={() => api.setSetting("maxOutputTokens", maxTokens)} />
            <span className="hint">Lower this if you hit a “requires more credits / fewer max_tokens” error.</span>
          </div>

          <div className="add-provider">
            <label>Add a provider:</label>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as ProviderKind)}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            <button className="btn" onClick={addProvider}>+ Add</button>
          </div>

          {providers.map((p) => (
            <ProviderCard
              key={p.id} p={p} test={tests[p.id]}
              isActive={active?.providerId === p.id}
              activeModel={active?.providerId === p.id ? active.model : undefined}
              onSaveKey={async (key) => { await api.saveProvider({ ...p, apiKey: key }); await refresh(); }}
              onSaveField={async (patch) => { await api.saveProvider({ ...p, ...patch }); await refresh(); }}
              onToggle={async (enabled) => { await api.saveProvider({ ...p, enabled }); await refresh(); }}
              onDelete={async () => { await api.deleteProvider(p.id); await refresh(); }}
              onTest={async () => {
                setTests((t) => ({ ...t, [p.id]: { testing: true } }));
                try {
                  const r = await api.testProvider(p.id);
                  setTests((t) => ({ ...t, [p.id]: { ...r, testing: false } }));
                } catch (e) {
                  setTests((t) => ({ ...t, [p.id]: { ok: false, error: e instanceof Error ? e.message : String(e), testing: false } }));
                }
              }}
              onUseModel={async (model) => { await api.useModel(p.id, model); await refresh(); }}
            />
          ))}

          <details className="advanced">
            <summary>Advanced — per-task model routing</summary>
            <p className="hint">Use different models for planning vs coding vs refactoring. Leave blank to use the active model.</p>
            <RoutingEditor providers={providers} routing={routing} onChange={async (r) => { setRouting(r); await api.saveRouting(r); }} />
          </details>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  p, test, isActive, activeModel, onSaveKey, onSaveField, onToggle, onDelete, onTest, onUseModel,
}: {
  p: SafeProviderConfig;
  test?: TestState;
  isActive: boolean;
  activeModel?: string;
  onSaveKey: (key: string) => Promise<void>;
  onSaveField: (patch: Partial<SafeProviderConfig>) => Promise<void>;
  onToggle: (enabled: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<void>;
  onUseModel: (model: string) => Promise<void>;
}) {
  const meta = KINDS.find((k) => k.id === p.kind);
  const isLocal = p.kind === "ollama" || p.kind === "lmstudio" || p.kind === "vllm";
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const [models, setModels] = useState<string[]>(test?.models ?? []);
  const [chosen, setChosen] = useState(activeModel ?? "");
  const [loadingModels, setLoadingModels] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const dot = test?.testing ? "off" : test?.ok ? "on" : test?.ok === false ? "err" : p.hasApiKey || isLocal ? "on" : "off";

  const saveKey = async () => {
    if (!key.trim()) return;
    await onSaveKey(key.trim());
    setKey("");
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const loadModels = async () => {
    setLoadingModels(true);
    try { setModels((await api.listModels(p.id)).map((m) => m.id)); }
    catch { /* surfaced via Test */ }
    finally { setLoadingModels(false); }
  };

  return (
    <div className={`prov-card ${isActive ? "is-active" : ""}`}>
      <div className="prov-head">
        <span className={`status-dot ${dot}`} />
        <span className="prov-name">{p.label}</span>
        {isActive && <span className="active-tag">ACTIVE</span>}
        <span className="hint">{p.kind}</span>
        <label className="switch">
          <input type="checkbox" checked={p.enabled} onChange={(e) => onToggle(e.target.checked)} /> enabled
        </label>
        <button className="btn ghost sm" onClick={onDelete} title="Remove">✕</button>
      </div>

      {!isLocal && (
        <div className="prov-key">
          <label>🔑 API Key</label>
          <input type="password" placeholder={p.hasApiKey ? "•••••••• saved — paste a new key to replace" : (meta?.hint ?? "paste your API key")}
            value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveKey()} />
          <button className="btn" onClick={saveKey} disabled={!key.trim()}>
            {savedFlash ? "✓ Saved" : p.hasApiKey ? "Update" : "Save Key"}
          </button>
          {p.hasApiKey && !key && <span className="key-ok">✓ key stored</span>}
        </div>
      )}

      {(isLocal || p.kind === "openai-compatible" || p.kind === "azure-openai") && (
        <div className="prov-key">
          <label>🔗 Base URL</label>
          <input placeholder={isLocal ? "(default local URL)" : "https://…"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <button className="btn ghost" onClick={() => onSaveField({ baseUrl: baseUrl || undefined })}>Save</button>
        </div>
      )}

      <div className="prov-models">
        <button className="btn ghost" onClick={loadModels} disabled={loadingModels}>
          {loadingModels ? "Loading…" : "↻ Load models"}
        </button>
        {models.length > 0 && (
          <>
            <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Select a model…</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn" disabled={!chosen} onClick={() => onUseModel(chosen)}>Use as default</button>
          </>
        )}
        <button className="btn ghost" onClick={onTest}>{test?.testing ? "Testing…" : "Test connection"}</button>
      </div>

      {test?.error && <div className="prov-msg err">✕ {test.error}</div>}
      {test?.ok && <div className="prov-msg ok">✓ Connected {test.latencyMs != null && `· ${test.latencyMs}ms`} · {test.models?.length ?? 0} models</div>}
    </div>
  );
}

function RoutingEditor({
  providers, routing, onChange,
}: {
  providers: SafeProviderConfig[];
  routing: ModelRouting;
  onChange: (r: ModelRouting) => void;
}) {
  const stages: (keyof ModelRouting)[] = ["planning", "coding", "refactoring", "embeddings", "titleGeneration"];
  const enabled = providers.filter((p) => p.enabled);
  return (
    <div className="routing-grid">
      {stages.map((stage) => {
        const cur = (routing[stage] as any) ?? {};
        return (
          <div className="routing-row" key={stage}>
            <label>{stage}</label>
            <select value={cur.providerId ?? ""} onChange={(e) => onChange({ ...routing, [stage]: { providerId: e.target.value, model: cur.model ?? "" } })}>
              <option value="">— active model —</option>
              {enabled.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input placeholder="model id" defaultValue={cur.model ?? ""}
              onBlur={(e) => onChange({ ...routing, [stage]: { providerId: cur.providerId ?? "", model: e.target.value } })} />
          </div>
        );
      })}
    </div>
  );
}
