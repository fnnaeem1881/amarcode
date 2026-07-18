import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Modal folder browser for selecting a project directory. */
export function ProjectPicker({ onPick, onClose }: { onPick: (dir: string) => void; onClose: () => void }) {
  const [dir, setDir] = useState<string>("");
  const [entries, setEntries] = useState<string[]>([]);
  const [error, setError] = useState<string>("");

  const load = async (d?: string) => {
    try {
      const r = await api.browse(d);
      setDir(r.dir);
      setEntries(r.entries);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const join = (name: string) => {
    const sep = dir.includes("\\") ? "\\" : "/";
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  };
  const parent = () => {
    const sep = dir.includes("\\") ? "\\" : "/";
    const parts = dir.replace(/[\\/]+$/, "").split(sep);
    parts.pop();
    load(parts.length <= 1 ? parts[0] + sep : parts.join(sep));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Select a project folder</h2>
        <div className="body">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(dir)}
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px" }}
            />
            <button className="btn ghost" onClick={() => load(dir)}>Go</button>
            <button className="btn ghost" onClick={parent}>↑ Up</button>
          </div>
          {error && <div style={{ color: "var(--red)", marginBottom: 8 }}>{error}</div>}
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, maxHeight: 300, overflow: "auto" }}>
            {entries.map((name) => (
              <div key={name} className="file" style={{ padding: "5px 12px" }} onClick={() => load(join(name))}>
                📁 {name}
              </div>
            ))}
            {!entries.length && <div className="hint" style={{ padding: 12 }}>No subfolders.</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={() => onPick(dir)}>Open this folder</button>
          </div>
        </div>
      </div>
    </div>
  );
}
