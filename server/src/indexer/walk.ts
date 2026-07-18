import fs from "node:fs";
import path from "node:path";

/** Directories and files never worth indexing. Keeps huge trees tractable. */
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "vendor", "dist", "build", "out",
  ".next", ".nuxt", ".expo", ".dart_tool", "target", "bin", "obj", "coverage",
  ".idea", ".vscode", "__pycache__", ".venv", "venv", "env", ".cache",
  ".turbo", ".gradle", "Pods", ".terraform", "tmp",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip",
  ".gz", ".tar", ".mp4", ".mov", ".mp3", ".woff", ".woff2", ".ttf", ".eot",
  ".lock", ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".wasm",
  ".map", ".min.js", ".min.css",
]);

const MAX_FILE_BYTES = 1_000_000; // skip files larger than ~1MB from content indexing

export interface WalkedFile {
  absPath: string;
  relPath: string; // POSIX separators
  size: number;
}

/**
 * Lazily walk a project, yielding indexable source files. Designed to stay
 * responsive on 100k+ file trees: prunes ignored dirs, skips binaries and
 * oversized files, and never buffers the whole listing.
 */
export function* walkProject(root: string): Generator<WalkedFile> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Skip ignored dirs and hidden dirs (except a few source-bearing ones).
        const allowedDot = e.name === ".github" || e.name === ".config";
        if (!IGNORED_DIRS.has(e.name) && (!e.name.startsWith(".") || allowedDot)) {
          stack.push(abs);
        }
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) continue;
      yield { absPath: abs, relPath: toPosix(path.relative(root, abs)), size };
    }
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}
