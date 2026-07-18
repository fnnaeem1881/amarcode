import { simpleGit, type SimpleGit } from "simple-git";
import type { ToolResult } from "@amarcode/shared";
import { ToolContext } from "./context.js";

function git(root: string): SimpleGit {
  return simpleGit({ baseDir: root });
}

async function ensureRepo(root: string): Promise<boolean> {
  try { return await git(root).checkIsRepo(); } catch { return false; }
}

export async function git_status(ctx: ToolContext): Promise<ToolResult> {
  if (!(await ensureRepo(ctx.root))) return { ok: false, output: "Not a git repository.", error: "not a repo" };
  const s = await git(ctx.root).status();
  const lines = [
    `On branch ${s.current ?? "(detached)"}`,
    ...s.files.map((f) => `${f.working_dir}${f.index} ${f.path}`),
  ];
  return { ok: true, output: lines.join("\n"), data: s };
}

export async function git_diff(ctx: ToolContext, args: { path?: string; staged?: boolean }): Promise<ToolResult> {
  if (!(await ensureRepo(ctx.root))) return { ok: false, output: "Not a git repository.", error: "not a repo" };
  const opts: string[] = [];
  if (args.staged) opts.push("--staged");
  if (args.path) opts.push("--", args.path);
  const diff = await git(ctx.root).diff(opts);
  return { ok: true, output: diff || "No changes.", data: { diff } };
}

export async function git_commit(ctx: ToolContext, args: { message: string; addAll?: boolean }): Promise<ToolResult> {
  if (!(await ensureRepo(ctx.root))) return { ok: false, output: "Not a git repository.", error: "not a repo" };
  if (!(await ctx.requestApproval(`Commit: "${args.message}"`, "confirm"))) return { ok: false, output: "Denied by user", error: "denied" };
  const g = git(ctx.root);
  if (args.addAll !== false) await g.add(".");
  const res = await g.commit(args.message);
  return { ok: true, output: `Committed ${res.commit} (${res.summary.changes} changes)`, data: res };
}

export async function git_branch(ctx: ToolContext, args: { name?: string }): Promise<ToolResult> {
  if (!(await ensureRepo(ctx.root))) return { ok: false, output: "Not a git repository.", error: "not a repo" };
  const g = git(ctx.root);
  if (args.name) {
    await g.checkoutLocalBranch(args.name);
    return { ok: true, output: `Created and switched to branch ${args.name}` };
  }
  const branches = await g.branchLocal();
  return { ok: true, output: branches.all.map((b) => (b === branches.current ? `* ${b}` : `  ${b}`)).join("\n"), data: branches };
}

export async function git_checkout(ctx: ToolContext, args: { ref: string }): Promise<ToolResult> {
  if (!(await ensureRepo(ctx.root))) return { ok: false, output: "Not a git repository.", error: "not a repo" };
  await git(ctx.root).checkout(args.ref);
  return { ok: true, output: `Checked out ${args.ref}` };
}
