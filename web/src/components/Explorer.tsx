import type { ProjectMetadata } from "@amarcode/shared";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }

export function Explorer({
  metadata, files, activePath, onOpen,
}: {
  metadata: ProjectMetadata | null;
  files: FileRow[];
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="pane explorer">
      <div className="section-title">Project</div>
      {metadata ? (
        <div className="meta-card">
          <div className="row"><span className="k">Name</span><span>{metadata.name}</span></div>
          <div className="row"><span className="k">Framework</span><span>{metadata.framework}</span></div>
          <div className="row"><span className="k">Language</span><span>{metadata.language}</span></div>
          {metadata.packageManager && <div className="row"><span className="k">Pkg mgr</span><span>{metadata.packageManager}</span></div>}
          {metadata.database && <div className="row"><span className="k">Database</span><span>{metadata.database}</span></div>}
          {metadata.testFramework && <div className="row"><span className="k">Tests</span><span>{metadata.testFramework}</span></div>}
          <div className="row"><span className="k">Docker</span><span>{metadata.usesDocker ? "yes" : "no"}</span></div>
          <div style={{ marginTop: 6 }}>
            {metadata.markers.slice(0, 8).map((m) => <span key={m} className="badge">{m}</span>)}
          </div>
        </div>
      ) : (
        <div className="hint" style={{ padding: 12 }}>No project scanned yet.</div>
      )}

      <div className="section-title">Files ({files.length})</div>
      {files
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .map((f) => (
          <div
            key={f.path}
            className={`file ${activePath === f.path ? "active" : ""}`}
            onClick={() => onOpen(f.path)}
            title={`${f.path} — ${f.symbols} symbols, importance ${f.importance.toFixed(2)}`}
          >
            {f.path.split("/").pop()}
            <span className="lang">{f.language}</span>
          </div>
        ))}
      {!files.length && <div className="hint" style={{ padding: 12 }}>Index the project to list files.</div>}
    </div>
  );
}
