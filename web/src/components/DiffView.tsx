/** Renders a unified diff with add/del/meta line coloring. */
export function DiffView({ unified }: { unified: string }) {
  return (
    <div className="diff">
      {unified.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++") ? "add"
          : line.startsWith("-") && !line.startsWith("---") ? "del"
          : line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") ? "meta"
          : "";
        return <div key={i} className={cls}>{line || " "}</div>;
      })}
    </div>
  );
}
