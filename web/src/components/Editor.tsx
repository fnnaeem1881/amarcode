export function Editor({ path, content }: { path: string | null; content: string }) {
  return (
    <div className="editor">
      {path ? (
        <>
          <div>
            <span className="tab active">{path.split("/").pop()}</span>
          </div>
          <pre>{content || "// empty file"}</pre>
        </>
      ) : (
        <div className="empty">
          <div style={{ fontSize: 40, marginBottom: 12 }}>⌘</div>
          <div>Select a file from the Explorer, or ask the assistant to make a change.</div>
        </div>
      )}
    </div>
  );
}
