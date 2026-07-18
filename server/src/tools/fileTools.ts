import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "@amarcode/shared";
import { ToolContext, resolveInRoot } from "./context.js";
import { makeUnifiedDiff } from "./diff.js";
import { indexer } from "../indexer/indexer.js";
import { isIgnoredDir } from "../indexer/walk.js";

export async function read_file(ctx: ToolContext, args: { path: string; startLine?: number; endLine?: number }): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!fs.existsSync(abs)) return err(`File not found: ${args.path}`);
  let content = fs.readFileSync(abs, "utf8");
  if (args.startLine || args.endLine) {
    const lines = content.split("\n");
    content = lines.slice((args.startLine ?? 1) - 1, args.endLine ?? lines.length).join("\n");
  }
  return { ok: true, output: content, data: { path: args.path } };
}

export async function write_file(ctx: ToolContext, args: { path: string; content: string }): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path);
  const existed = fs.existsSync(abs);
  const before = existed ? fs.readFileSync(abs, "utf8") : "";
  if (existed && !(await ctx.requestApproval(`Overwrite ${args.path}`, "confirm"))) return err("Denied by user");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, args.content, "utf8");
  indexer.reindexFile(ctx.root, abs);
  const diff = makeUnifiedDiff(args.path, before, args.content);
  ctx.emit?.({ type: "diff", payload: diff });
  return { ok: true, output: `${existed ? "Updated" : "Created"} ${args.path}`, data: diff };
}

export async function create_file(ctx: ToolContext, args: { path: string; content?: string }): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (fs.existsSync(abs)) return err(`File already exists: ${args.path}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, args.content ?? "", "utf8");
  indexer.reindexFile(ctx.root, abs);
  return { ok: true, output: `Created ${args.path}` };
}

/**
 * Minimal-diff edit: replace an exact `oldText` span with `newText`.
 * Never rewrites the whole file; the change is shown as a unified diff.
 */
export async function edit_file(
  ctx: ToolContext,
  args: { path: string; oldText: string; newText: string; replaceAll?: boolean },
): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!fs.existsSync(abs)) return err(`File not found: ${args.path}`);
  const before = fs.readFileSync(abs, "utf8");
  if (!before.includes(args.oldText)) {
    return err(`oldText not found in ${args.path}. Read the file first and match exactly.`);
  }
  const occurrences = before.split(args.oldText).length - 1;
  if (occurrences > 1 && !args.replaceAll) {
    return err(`oldText matches ${occurrences} times in ${args.path}; make it unique or set replaceAll.`);
  }
  const after = args.replaceAll
    ? before.split(args.oldText).join(args.newText)
    : before.replace(args.oldText, args.newText);
  const diff = makeUnifiedDiff(args.path, before, after);
  if (!(await ctx.requestApproval(`Edit ${args.path}`, "confirm", diff.unified))) return err("Denied by user");
  fs.writeFileSync(abs, after, "utf8");
  indexer.reindexFile(ctx.root, abs);
  ctx.emit?.({ type: "diff", payload: diff });
  return { ok: true, output: `Edited ${args.path}`, data: diff };
}

export async function delete_file(ctx: ToolContext, args: { path: string }): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!fs.existsSync(abs)) return err(`File not found: ${args.path}`);
  if (!(await ctx.requestApproval(`Delete ${args.path}`, "dangerous"))) return err("Denied by user");
  fs.rmSync(abs, { recursive: true, force: true });
  indexer.reindexFile(ctx.root, abs);
  return { ok: true, output: `Deleted ${args.path}` };
}

export async function rename_file(ctx: ToolContext, args: { from: string; to: string }): Promise<ToolResult> {
  return moveOrRename(ctx, args.from, args.to, "Rename");
}
export async function move_file(ctx: ToolContext, args: { from: string; to: string }): Promise<ToolResult> {
  return moveOrRename(ctx, args.from, args.to, "Move");
}

async function moveOrRename(ctx: ToolContext, from: string, to: string, verb: string): Promise<ToolResult> {
  const absFrom = resolveInRoot(ctx.root, from);
  const absTo = resolveInRoot(ctx.root, to);
  if (!fs.existsSync(absFrom)) return err(`Not found: ${from}`);
  if (!(await ctx.requestApproval(`${verb} ${from} → ${to}`, "confirm"))) return err("Denied by user");
  fs.mkdirSync(path.dirname(absTo), { recursive: true });
  fs.renameSync(absFrom, absTo);
  indexer.reindexFile(ctx.root, absFrom);
  indexer.reindexFile(ctx.root, absTo);
  return { ok: true, output: `${verb}d ${from} → ${to}` };
}

export async function list_directory(ctx: ToolContext, args: { path?: string }): Promise<ToolResult> {
  const abs = resolveInRoot(ctx.root, args.path ?? ".");
  if (!fs.existsSync(abs)) return err(`Not found: ${args.path}`);
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => !(e.isDirectory() && isIgnoredDir(e.name)))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  return { ok: true, output: entries.join("\n"), data: { path: args.path ?? ".", entries } };
}

function err(message: string): ToolResult {
  return { ok: false, output: message, error: message };
}
