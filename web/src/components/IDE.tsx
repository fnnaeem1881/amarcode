import { useEffect, useState } from "react";
import { FileTree } from "./FileTree.js";
import { api } from "../api.js";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }

/** File explorer + editable code editor with save. Opened via the IDE button. */
export function IDE({
  root, files, activePath, content, onOpenFile, onSaved,
}: {
  root: string;
  files: FileRow[];
  activePath: string | null;
  content: string;
  onOpenFile: (path: string) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Load new file content when the active file changes.
  useEffect(() => { setText(content); setDirty(false); setMsg(""); }, [content, activePath]);

  const save = async () => {
    if (!activePath) return;
    setSaving(true); setMsg("");
    try { await api.saveFile(root, activePath, text); setDirty(false); setMsg("Saved ✓"); onSaved(); }
    catch (e) { setMsg(`Save failed: ${e instanceof Error ? e.message : e}`); }
    finally { setSaving(false); setTimeout(() => setMsg(""), 2000); }
  };

  const lines = text.split("\n");

  return (
    <div className="ide">
      <div className="ide-tree">
        <div className="ide-tree-head">Explorer</div>
        <FileTree files={files} activePath={activePath} onOpen={onOpenFile} />
      </div>
      <div className="ide-editor">
        <div className="ide-tab">
          <span className="ide-path">{activePath ?? "Select a file"}{dirty ? " ●" : ""}</span>
          {msg && <span className="ide-msg">{msg}</span>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={save} disabled={!activePath || !dirty || saving}
            title="Save (Ctrl+S)">{saving ? "Saving…" : "💾 Save"}</button>
        </div>
        {activePath ? (
          <div className="ide-code">
            <pre className="ide-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</pre>
            <textarea
              className="ide-text"
              value={text}
              spellCheck={false}
              onChange={(e) => { setText(e.target.value); setDirty(true); }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
                if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; const v = t.value; setText(v.slice(0, s) + "  " + v.slice(t.selectionEnd)); setDirty(true); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; }); }
              }}
            />
          </div>
        ) : (
          <div className="ide-empty hint">Pick a file from the Explorer to edit it.</div>
        )}
      </div>
    </div>
  );
}
