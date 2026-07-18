import { spawn } from "node:child_process";
import type { ToolResult } from "@amarcode/shared";
import { ToolContext, classifyCommandRisk } from "./context.js";

/**
 * Runs shell commands, capturing stdout+stderr and feeding results back to the
 * agent. Dangerous commands are gated behind explicit user approval. Uses
 * child_process (no native node-pty dependency); a PTY can be swapped in later
 * for interactive programs.
 */
export async function run_terminal(
  ctx: ToolContext,
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<ToolResult> {
  const risk = classifyCommandRisk(args.command);
  if (risk !== "safe") {
    const approved = await ctx.requestApproval(`Run: ${args.command}`, risk, riskWarning(risk));
    if (!approved) return { ok: false, output: "Command denied by user.", error: "denied" };
  }
  return execCapture(ctx, args.command, args.cwd, args.timeoutMs);
}

export async function run_tests(ctx: ToolContext, args: { command?: string }): Promise<ToolResult> {
  return execCapture(ctx, args.command ?? "npm test", undefined, 300_000);
}

export async function run_build(ctx: ToolContext, args: { command?: string }): Promise<ToolResult> {
  return execCapture(ctx, args.command ?? "npm run build", undefined, 600_000);
}

function execCapture(ctx: ToolContext, command: string, cwd?: string, timeoutMs = 120_000): Promise<ToolResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/sh";
    const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];
    const child = spawn(shell, shellArgs, { cwd: cwd ? cwd : ctx.root });

    let out = "";
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutMs);
    const onData = (buf: Buffer) => {
      const chunk = buf.toString();
      out += chunk;
      ctx.emit?.({ type: "terminal", payload: chunk });
      if (out.length > 200_000) out = out.slice(-200_000); // cap retained output
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      const status = killed ? "timed out" : `exit code ${code}`;
      resolve({
        ok: code === 0 && !killed,
        output: `$ ${command}\n${out}\n[${status}]`,
        data: { command, exitCode: code, killed },
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `Failed to run: ${e.message}`, error: e.message });
    });
  });
}

function riskWarning(risk: string): string {
  return risk === "dangerous"
    ? "⚠️ This is a potentially destructive command. Review carefully before approving."
    : "This command may modify state. Confirm to proceed.";
}
