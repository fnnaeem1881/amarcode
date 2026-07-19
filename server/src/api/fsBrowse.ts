import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Filesystem browsing for the project picker. Robust across Windows drives and
 * POSIX roots: normalises paths, computes a correct parent (null at a root),
 * and lists sub-directories. Used only to let the user choose a project folder.
 */

export interface DirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
  isProject: boolean; // contains a recognizable project marker
}

export interface DirListing {
  dir: string;
  parent: string | null;
  entries: DirEntry[];
  /** Path split into clickable breadcrumb segments. */
  crumbs: { label: string; path: string }[];
}

const PROJECT_MARKERS = [
  "package.json", "composer.json", "pubspec.yaml", "go.mod", "Cargo.toml",
  ".git", "pom.xml", "build.gradle", "requirements.txt", "pyproject.toml",
];

/** Detected drive roots (Windows) or "/" (POSIX), plus the home directory. */
export function roots(): { label: string; path: string }[] {
  const home = os.homedir();
  if (process.platform !== "win32") {
    return [
      { label: "/", path: "/" },
      { label: "~ Home", path: home },
    ];
  }
  const drives: { label: string; path: string }[] = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    try {
      fs.accessSync(root);
      drives.push({ label: `${letter}:`, path: root });
    } catch {
      /* drive not present */
    }
  }
  drives.push({ label: "🏠 Home", path: home });
  return drives;
}

export function homeDir(): string {
  return os.homedir();
}

function computeParent(dir: string): string | null {
  const parent = path.dirname(dir);
  // path.dirname("C:\\") === "C:\\"; path.dirname("/") === "/"
  if (parent === dir) return null;
  return parent;
}

function buildCrumbs(dir: string): { label: string; path: string }[] {
  const crumbs: { label: string; path: string }[] = [];
  let cur = dir;
  // Walk up to the root, collecting segments.
  const guard = 64;
  for (let i = 0; i < guard; i++) {
    const base = path.basename(cur);
    const parent = computeParent(cur);
    crumbs.unshift({ label: base || cur, path: cur });
    if (!parent) break;
    cur = parent;
  }
  return crumbs;
}

export function list(rawDir?: string): DirListing {
  let dir = rawDir && rawDir.trim() ? rawDir.trim() : os.homedir();
  // Normalise (collapses .., trailing slashes) but keep drive roots intact.
  dir = path.resolve(dir);

  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // If the path is unreadable, fall back to the home directory.
    dir = os.homedir();
    names = fs.readdirSync(dir, { withFileTypes: true });
  }

  const dirs = names
    .filter((e) => {
      try { return e.isDirectory(); }
      catch { return false; }
    })
    .filter((e) => e.name !== "$RECYCLE.BIN" && e.name !== "System Volume Information");

  // Probing every subfolder for children/markers can block the event loop on
  // drive roots with large folders, so only probe project markers, and cap it.
  const PROBE_CAP = 400;
  const entries: DirEntry[] = dirs.map((e, i) => {
    const full = path.join(dir, e.name);
    return {
      name: e.name,
      path: full,
      hasChildren: true, // assume navigable; the listing shows "empty" if not
      isProject: i < PROBE_CAP ? PROJECT_MARKERS.some((m) => safeExists(path.join(full, m))) : false,
    };
  }).sort((a, b) => {
    // Projects first, then case-insensitive name.
    if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { dir, parent: computeParent(dir), entries, crumbs: buildCrumbs(dir) };
}

function safeExists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}
