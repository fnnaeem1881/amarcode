import { Fragment, useEffect, useState } from "react";
import type { ProviderKind, SafeProviderConfig, ModelRouting } from "@amarcode/shared";
import { api } from "../api.js";

const KINDS: ProviderKind[] = [
  "openai", "anthropic", "gemini", "openrouter", "ollama", "lmstudio", "vllm",
  "together", "groq", "fireworks", "deepseek", "mistral", "azure-openai", "openai-compatible",
];

type TestState = Record<string, { ok?: boolean; latencyMs?: number; error?: string; models?: string[]; testing?: boolean }>;

export function Settings({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<SafeProviderConfig[]>([]);
  const [tests, setTests] = useState<TestState>({});
  const [routing, setRouting] = useState<ModelRouting>({});
  const [newKind, setNewKind] = useState<ProviderKind>("openai");

  const refresh = async () => {
    setProviders(await api.listProviders());
    setRouting(await api.getRouting());
  };
  useEffect(() => { refresh(); }, []);

  const save = async (p: SafeProviderConfig, apiKey?: string) => {
    await api.saveProvider({ ...p, ...(apiKey !== undefined ? { apiKey } : {}) });
    await refresh();
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { testing: true } }));
    try {
      const r = await api.testProvider(id);
      setTests((t) => ({ ...t, [id]: { ...r, testing: false } }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: e instanceof Error ? e.message : String(e), testing: false } }));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>AI Settings — Providers & Models</h2>
        <div className="body">
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as ProviderKind)}
              style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px" }}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="btn" onClick={() => api.saveProvider({ kind: newKind } as any).then(refresh)}>+ Add provider</button>
          </div>

          {providers.map((p) => (
            <ProviderRow key={p.id} p={p} test={tests[p.id]} onSave={save} onTest={() => test(p.id)}
              onDelete={() => api.deleteProvider(p.id).then(refresh)} />
          ))}

          <h3 style={{ marginTop: 20 }}>Multi-model routing</h3>
          <p className="hint">Assign a provider/model per workflow stage. Leave blank to use the first enabled provider.</p>
          <RoutingEditor providers={providers} routing={routing} onChange={async (r) => { setRouting(r); await api.saveRouting(r); }} />

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderRow({
  p, test, onSave, onTest, onDelete,
}: {
  p: SafeProviderConfig;
  test?: TestState[string];
  onSave: (p: SafeProviderConfig, apiKey?: string) => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const dot = test?.testing ? "off" : test?.ok ? "on" : test?.ok === false ? "err" : "off";

  return (
    <div className="provider-row">
      <div className="head">
        <span className={`status-dot ${dot}`} />
        <span className="name">{p.label}</span>
        <span className="hint">({p.kind})</span>
        <label style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={p.enabled} onChange={(e) => onSave({ ...p, enabled: e.target.checked })} /> enabled
        </label>
        <button className="btn ghost" onClick={onTest}>{test?.testing ? "Testing…" : "Test"}</button>
        <button className="btn ghost" onClick={onDelete}>✕</button>
      </div>

      <div className="grid">
        {p.kind !== "ollama" && p.kind !== "lmstudio" && p.kind !== "vllm" && (
          <>
            <label>API key</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="password" placeholder={p.hasApiKey ? "•••••• (saved)" : "sk-…"} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn ghost" onClick={() => { onSave(p, key); setKey(""); }}>Save</button>
            </div>
          </>
        )}
        <label>Base URL</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input placeholder="(default)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <button className="btn ghost" onClick={() => onSave({ ...p, baseUrl: baseUrl || undefined })}>Save</button>
        </div>
        {p.kind === "azure-openai" && (
          <>
            <label>Deployment</label>
            <input defaultValue={p.azureDeployment} onBlur={(e) => onSave({ ...p, azureDeployment: e.target.value })} />
            <label>API version</label>
            <input defaultValue={p.azureApiVersion} onBlur={(e) => onSave({ ...p, azureApiVersion: e.target.value })} />
          </>
        )}
        {p.kind === "openrouter" && (
          <>
            <label>App name</label>
            <input defaultValue={p.appName} onBlur={(e) => onSave({ ...p, appName: e.target.value })} />
          </>
        )}
      </div>

      {test?.error && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12 }}>{test.error}</div>}
      {test?.ok && <div style={{ color: "var(--green)", marginTop: 6, fontSize: 12 }}>✓ Connected {test.latencyMs != null && `(${test.latencyMs}ms)`} — {test.models?.length ?? 0} models</div>}
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
    <div className="grid" style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "6px 10px", alignItems: "center" }}>
      {stages.map((stage) => {
        const cur = (routing[stage] as any) ?? {};
        return (
          <Fragment key={stage}>
            <label>{stage}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={cur.providerId ?? ""} onChange={(e) => onChange({ ...routing, [stage]: { providerId: e.target.value, model: cur.model ?? "" } })}
                style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px" }}>
                <option value="">—</option>
                {enabled.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input placeholder="model id" defaultValue={cur.model ?? ""}
                onBlur={(e) => onChange({ ...routing, [stage]: { providerId: cur.providerId ?? "", model: e.target.value } })}
                style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px", flex: 1 }} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
