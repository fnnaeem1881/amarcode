import { useMemo, useState } from "react";

interface FileRow { path: string; language: string; size: number; symbols: number; importance: number }

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

function buildTree(files: FileRow[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  const dirMap = new Map<string, TreeNode>([["", root]]);

  for (const f of files) {
    const parts = f.path.split("/");
    let parentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (!dirMap.has(path)) {
        const node: TreeNode = { name: parts[i], path, dir: !isFile, children: [] };
        dirMap.get(parentPath)!.children.push(node);
        if (!isFile) dirMap.set(path, node);
      }
      parentPath = path;
    }
  }

  // Sort: folders first, then files, alphabetically.
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

const ICONS: Record<string, string> = {
  ts: "🟦", tsx: "⚛️", js: "🟨", jsx: "⚛️", json: "🟫", md: "📄", css: "🎨",
  html: "🌐", php: "🐘", py: "🐍", go: "🐹", rs: "🦀", dart: "🎯", java: "☕",
  vue: "💚", yml: "⚙️", yaml: "⚙️", sql: "🗄️", sh: "🐚",
};
function fileIcon(name: string): string {
  return ICONS[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "📄";
}

export function FileTree({ files, activePath, onOpen }: { files: FileRow[]; activePath: string | null; onOpen: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  // Expand the top-level folders by default so files are visible.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.children.filter((c) => c.dir).map((c) => c.path)));

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.dir) {
      const open = expanded.has(node.path);
      return (
        <div key={node.path}>
          <div className="ft-row ft-dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(node.path)}>
            <span className="ft-caret">{open ? "▾" : "▸"}</span>
            <span className="ft-name">{node.name}</span>
          </div>
          {open && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    return (
      <div key={node.path}
        className={`ft-row ft-file ${activePath === node.path ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onOpen(node.path)} title={node.path}>
        <span className="ft-icon">{fileIcon(node.name)}</span>
        <span className="ft-name">{node.name}</span>
      </div>
    );
  };

  if (!files.length) return <div className="hint" style={{ padding: "4px 14px" }}>Open a project to see files.</div>;
  return <div className="ft">{tree.children.map((c) => renderNode(c, 0))}</div>;
}
