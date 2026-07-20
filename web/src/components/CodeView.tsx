/** Full-area code viewer shown when the "Code" tab is active. */
export function CodeView({ path, content, projectName }: { path: string | null; content: string; projectName: string }) {
  if (!path) {
    return (
      <div className="codeview empty">
        <div style={{ fontSize: 40, marginBottom: 12 }}>&lt;/&gt;</div>
        <div className="cc-empty-title">Code</div>
        <div className="hint">Pick a file from the left to view it{projectName ? ` in ${projectName}` : ""}.</div>
      </div>
    );
  }
  const lines = content.split("\n");
  return (
    <div className="codeview">
      <div className="codeview-tab">{path}</div>
      <div className="codeview-body">
        <pre className="gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</pre>
        <pre className="code">{content || "// empty file"}</pre>
      </div>
    </div>
  );
}
