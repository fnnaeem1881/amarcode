import { useEffect, useState, useCallback } from "react";
import { api, type DirListing } from "../api.js";

/**
 * Modern folder picker: drive/root rail, breadcrumbs, working Up navigation,
 * typed-path entry with validation, and project markers highlighted. Works on
 * any Windows drive or POSIX root.
 */
export function ProjectPicker({ onPick, onClose }: { onPick: (dir: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [roots, setRoots] = useState<{ label: string; path: string }[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (dir?: string) => {
    setLoading(true);
    try {
      const r = await api.browse(dir);
      setListing(r);
      setPathInput(r.dir);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.fsRoots().then((r) => setRoots(r.roots)).catch(() => {});
    load();
  }, [load]);

  const go = async () => {
    const p = pathInput.trim();
    if (!p) return;
    const v = await api.fsValidate(p).catch(() => ({ valid: false } as any));
    if (!v.valid) { setError(`Not a folder: ${p}`); return; }
    load(p);
  };

  const open = async () => {
    const dir = listing?.dir ?? pathInput.trim();
    const v = await api.fsValidate(dir).catch(() => ({ valid: false } as any));
    if (!v.valid) { setError(`Not a folder: ${dir}`); return; }
    onPick(dir);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h2>Open a project folder</h2>

        <div className="picker-toolbar">
          <button className="btn ghost" disabled={!listing?.parent || loading}
            onClick={() => listing?.parent && load(listing.parent)} title="Up one level">↑ Up</button>
          <div className="crumbs">
            {listing?.crumbs.map((c, i) => (
              <span key={c.path}>
                {i > 0 && <span className="sep">›</span>}
                <button className="crumb" onClick={() => load(c.path)}>{c.label}</button>
              </span>
            ))}
          </div>
        </div>

        <div className="picker-path">
          <input
            value={pathInput}
            spellCheck={false}
            placeholder="Paste or type a full path…"
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          <button className="btn ghost" onClick={go} disabled={loading}>Go</button>
        </div>

        <div className="picker-body">
          <div className="picker-rail">
            <div className="rail-title">This PC</div>
            {roots.map((r) => (
              <button key={r.path} className="rail-item" onClick={() => load(r.path)}>{r.label}</button>
            ))}
          </div>

          <div className="picker-list">
            {loading && <div className="hint" style={{ padding: 12 }}>Loading…</div>}
            {!loading && listing?.entries.length === 0 && <div className="hint" style={{ padding: 12 }}>No sub-folders here. You can still open this folder.</div>}
            {!loading && listing?.entries.map((e) => (
              <div key={e.path} className={`picker-entry ${e.isProject ? "project" : ""}`}
                onClick={() => setPathInput(e.path)}
                onDoubleClick={() => (e.isProject ? onPick(e.path) : load(e.path))}
                title={e.path}>
                <span className="ico">{e.isProject ? "📦" : "📁"}</span>
                <span className="nm">{e.name}</span>
                {e.isProject && <span className="tag">open</span>}
                <button className="into" onClick={(ev) => { ev.stopPropagation(); load(e.path); }} title="Enter folder">→</button>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="picker-error">{error}</div>}

        <div className="picker-footer">
          <span className="hint">Double-click a 📦 to open it, or select any folder.</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={open} disabled={loading}>Open {listing ? shortName(listing.dir) : ""}</button>
        </div>
      </div>
    </div>
  );
}

function shortName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || dir;
}
