import { simpleGit, type SimpleGit } from "simple-git";
import { classifyCommandRisk } from "../tools/context.js";

/**
 * Direct git operations for the UI's source-control panel. Unlike the agent's
 * git tools (which route through approval), these are invoked by explicit user
 * clicks, so they run directly — except destructive ops, which are flagged.
 */
function git(root: string): SimpleGit {
  return simpleGit({ baseDir: root });
}

export async function isRepo(root: string): Promise<boolean> {
  try { return await git(root).checkIsRepo(); } catch { return false; }
}

export async function initRepo(root: string): Promise<void> {
  await git(root).init();
}

export interface GitStatusFile {
  path: string;
  index: string;   // staged status code
  working: string; // working-tree status code
  staged: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  tracking: string | null;
}

export async function status(root: string): Promise<GitStatus> {
  if (!(await isRepo(root))) {
    return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [], tracking: null };
  }
  const s = await git(root).status();
  return {
    isRepo: true,
    branch: s.current ?? null,
    ahead: s.ahead,
    behind: s.behind,
    tracking: s.tracking ?? null,
    files: s.files.map((f) => ({
      path: f.path,
      index: f.index,
      working: f.working_dir,
      staged: f.index !== " " && f.index !== "?",
    })),
  };
}

export async function diff(root: string, path?: string, staged = false): Promise<string> {
  const opts: string[] = [];
  if (staged) opts.push("--staged");
  if (path) opts.push("--", path);
  return git(root).diff(opts);
}

export async function stage(root: string, path: string): Promise<void> {
  await git(root).add(path);
}
export async function unstage(root: string, path: string): Promise<void> {
  await git(root).reset(["--", path]);
}
export async function stageAll(root: string): Promise<void> {
  await git(root).add(".");
}

export async function commit(root: string, message: string, addAll: boolean): Promise<{ commit: string; changes: number }> {
  const g = git(root);
  if (addAll) await g.add(".");
  const res = await g.commit(message);
  return { commit: res.commit, changes: res.summary.changes };
}

export async function branches(root: string): Promise<{ current: string; all: string[] }> {
  const b = await git(root).branchLocal();
  return { current: b.current, all: b.all };
}

export async function checkout(root: string, ref: string): Promise<void> {
  await git(root).checkout(ref);
}
export async function createBranch(root: string, name: string): Promise<void> {
  await git(root).checkoutLocalBranch(name);
}

export async function log(root: string, limit = 20): Promise<{ hash: string; message: string; author: string; date: string }[]> {
  if (!(await isRepo(root))) return [];
  const l = await git(root).log({ maxCount: limit });
  return l.all.map((c) => ({ hash: c.hash.slice(0, 8), message: c.message, author: c.author_name, date: c.date }));
}

/** Discard working-tree changes for a file — destructive, so flag it. */
export async function discard(root: string, path: string): Promise<void> {
  await git(root).checkout(["--", path]);
}

export function isDangerous(command: string): boolean {
  return classifyCommandRisk(command) === "dangerous";
}
