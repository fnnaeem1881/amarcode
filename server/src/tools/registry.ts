import type { ToolDescriptor, ToolResult, ToolSchema } from "@amarcode/shared";
import { ToolContext } from "./context.js";
import * as file from "./fileTools.js";
import * as search from "./searchTools.js";
import * as git from "./gitTools.js";
import * as term from "./terminalTools.js";
import * as srv from "./serverTools.js";

type Executor = (ctx: ToolContext, args: any) => Promise<ToolResult>;

interface ToolDef extends ToolDescriptor {
  run: Executor;
}

const str = (description: string) => ({ type: "string", description });
const optStr = (description: string) => ({ type: "string", description });

/** Every operation the agent can perform. Nothing bypasses this registry. */
const TOOLS: ToolDef[] = [
  {
    name: "read_file", risk: "safe", run: file.read_file,
    description: "Read a file's contents. Optionally restrict to a line range.",
    parameters: obj({ path: str("Project-relative file path"), startLine: { type: "number" }, endLine: { type: "number" } }, ["path"]),
  },
  {
    name: "write_file", risk: "confirm", run: file.write_file,
    description: "Create or fully overwrite a file. Prefer edit_file for changes to existing files.",
    parameters: obj({ path: str("Project-relative path"), content: str("Full file content") }, ["path", "content"]),
  },
  {
    name: "create_file", risk: "confirm", run: file.create_file,
    description: "Create a new file. Fails if it already exists.",
    parameters: obj({ path: str("Project-relative path"), content: optStr("Initial content") }, ["path"]),
  },
  {
    name: "edit_file", risk: "confirm", run: file.edit_file,
    description: "Make a minimal edit by replacing an exact text span. oldText must match exactly and uniquely (unless replaceAll).",
    parameters: obj({
      path: str("Project-relative path"),
      oldText: str("Exact existing text to replace"),
      newText: str("Replacement text"),
      replaceAll: { type: "boolean", description: "Replace every occurrence" },
    }, ["path", "oldText", "newText"]),
  },
  {
    name: "delete_file", risk: "dangerous", run: file.delete_file,
    description: "Delete a file or directory. Requires confirmation.",
    parameters: obj({ path: str("Project-relative path") }, ["path"]),
  },
  {
    name: "rename_file", risk: "confirm", run: file.rename_file,
    description: "Rename a file.",
    parameters: obj({ from: str("Current path"), to: str("New path") }, ["from", "to"]),
  },
  {
    name: "move_file", risk: "confirm", run: file.move_file,
    description: "Move a file to a new location.",
    parameters: obj({ from: str("Current path"), to: str("Destination path") }, ["from", "to"]),
  },
  {
    name: "list_directory", risk: "safe", run: file.list_directory,
    description: "List files and folders in a directory.",
    parameters: obj({ path: optStr("Directory (default project root)") }, []),
  },
  {
    name: "search_text", risk: "safe", run: search.search_text,
    description: "Full-text search across indexed files.",
    parameters: obj({ query: str("Text or regex to find"), maxResults: { type: "number" } }, ["query"]),
  },
  {
    name: "search_symbol", risk: "safe", run: search.search_symbol,
    description: "Find where a class/function/interface symbol is defined.",
    parameters: obj({ symbol: str("Symbol name") }, ["symbol"]),
  },
  {
    name: "semantic_search", risk: "safe", run: search.semantic_search,
    description: "Semantically retrieve the most relevant code chunks for a concept or task.",
    parameters: obj({ query: str("Natural-language description"), limit: { type: "number" } }, ["query"]),
  },
  {
    name: "run_terminal", risk: "confirm", run: term.run_terminal,
    description: "Run a shell command in the project. Captures stdout/stderr. Dangerous commands require approval.",
    parameters: obj({ command: str("Command line"), cwd: optStr("Working dir"), timeoutMs: { type: "number" } }, ["command"]),
  },
  {
    name: "run_tests", risk: "confirm", run: term.run_tests,
    description: "Run the project's test suite.",
    parameters: obj({ command: optStr("Override test command") }, []),
  },
  {
    name: "run_build", risk: "confirm", run: term.run_build,
    description: "Build the project.",
    parameters: obj({ command: optStr("Override build command") }, []),
  },
  {
    name: "start_dev_server", risk: "confirm", run: srv.start_dev_server,
    description: "Start a long-running dev server (e.g. 'npm run dev') in the background and detect its URL. Use this to run a web app, then test it. Keeps running (unlike run_terminal).",
    parameters: obj({ command: str("Command that starts the server, e.g. 'npm run dev'") }, ["command"]),
  },
  {
    name: "stop_dev_server", risk: "safe", run: srv.stop_dev_server,
    description: "Stop the running dev server.",
    parameters: obj({}, []),
  },
  {
    name: "get_server_logs", risk: "safe", run: srv.get_server_logs,
    description: "Read the running dev server's stdout/stderr — use this to find errors, stack traces and crashes.",
    parameters: obj({ lines: { type: "number", description: "How many recent lines" } }, []),
  },
  {
    name: "http_request", risk: "safe", run: srv.http_request,
    description: "Test a URL/endpoint over HTTP to check the app works (non-2xx or errors are flagged). If the user gives a full URL (e.g. http://localhost:5319/), pass that FULL URL as `path`. Otherwise a relative path uses the running/previewed server's URL.",
    parameters: obj({ path: str("Full URL if the user gave one (http://localhost:5319/), else a relative path like '/users'"), method: optStr("GET/POST/…"), body: optStr("JSON request body") }, ["path"]),
  },
  {
    name: "git_status", risk: "safe", run: git.git_status,
    description: "Show git working-tree status.", parameters: obj({}, []),
  },
  {
    name: "git_diff", risk: "safe", run: git.git_diff,
    description: "Show the git diff of changes.",
    parameters: obj({ path: optStr("Limit to path"), staged: { type: "boolean" } }, []),
  },
  {
    name: "git_commit", risk: "confirm", run: git.git_commit,
    description: "Stage and commit changes with a message.",
    parameters: obj({ message: str("Commit message"), addAll: { type: "boolean" } }, ["message"]),
  },
  {
    name: "git_branch", risk: "safe", run: git.git_branch,
    description: "List branches, or create+switch to a new one if name is given.",
    parameters: obj({ name: optStr("New branch name") }, []),
  },
  {
    name: "git_checkout", risk: "confirm", run: git.git_checkout,
    description: "Check out a branch or ref.",
    parameters: obj({ ref: str("Branch or commit ref") }, ["ref"]),
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export class ToolRegistry {
  /** JSON-schema tool definitions to advertise to the provider. */
  schemas(): ToolSchema[] {
    return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  descriptors(): ToolDescriptor[] {
    return TOOLS.map(({ run, ...rest }) => rest);
  }

  risk(name: string): ToolDescriptor["risk"] | undefined {
    return byName.get(name)?.risk;
  }

  async execute(name: string, ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = byName.get(name);
    if (!tool) return { ok: false, output: `Unknown tool: ${name}`, error: "unknown_tool" };
    try {
      return await tool.run(ctx, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, output: `Tool ${name} failed: ${msg}`, error: msg };
    }
  }
}

function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required };
}

export const toolRegistry = new ToolRegistry();
