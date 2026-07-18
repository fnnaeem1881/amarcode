# AmarCode — AI Coding Assistant (Claude Code style)

A modular, multi-provider AI coding assistant that scans a local project,
indexes it, retrieves only the relevant files (never the whole project), plans
a task, and edits code through a tool-calling agent loop — with a VS Code–like
desktop-style UI.

> **Status:** This is a working **foundation / vertical slice**, not a finished
> product. The full engine pipeline (scan → index → embed → retrieve → plan →
> agent tool loop → diff → git) is implemented and runs end-to-end. Some
> advanced features from the original spec are intentionally scaffolded with
> clean extension points rather than fully built out — see
> [Status & roadmap](#status--roadmap).

## Architecture

```
shared/   Type contracts shared by server + web (no runtime deps)
server/   The engine (Node + TypeScript, Express + WS, node:sqlite)
web/      The UI (React + TypeScript + Vite)
```

```
User request
   ↓
Context Builder  ── semantic search + importance + graph + keyword ranking
   ↓
Provider Router  ── unified interface, per-task routing, fallback chain
   ↓
Agent Loop       ── streams model output, executes tools, feeds results back
   ↓
Tools            ── read/write/edit/search/git/terminal (all go through here)
```

Key modules:

| Concern | Location |
| --- | --- |
| Provider abstraction (unified interface) | `server/src/providers/types.ts` |
| Providers | `openaiCompatible.ts`, `anthropic.ts`, `gemini.ts`, `ollama.ts` |
| Routing + fallback + multi-model | `server/src/providers/router.ts` |
| Encrypted key storage | `server/src/core/crypto.ts` |
| Project scan / metadata | `server/src/scanner/scanner.ts` |
| File index (incremental, hashed) | `server/src/indexer/indexer.ts` |
| Pluggable parser (Tree-sitter/LSP hook) | `server/src/indexer/parser.ts` |
| Dependency graph / go-to-def | `server/src/indexer/graph.ts` |
| Embeddings + semantic search | `server/src/context/embeddings.ts` |
| Context manager / token budgeting | `server/src/context/contextManager.ts` |
| Planner agent | `server/src/agent/planner.ts` |
| Agent tool loop | `server/src/agent/agentLoop.ts` |
| Tool registry | `server/src/tools/registry.ts` |
| Cost tracking | `server/src/agent/cost.ts` |

## Requirements

- Node.js ≥ 20 (uses the built-in `node:sqlite`, so **no native build step**)
- npm

## Setup

```bash
npm install
npm run build         # builds shared, server, web
```

## Run (development)

```bash
npm run dev           # starts engine (:4319) and UI (:5319) together
```

Then open **http://localhost:5319**.

1. Click **📂 Open project** and pick any project folder.
2. It scans → indexes → starts background embedding automatically.
3. Open **⚙ AI Settings**, add an API key for a provider, click **Test**.
   (Ollama works with no key if you have it running locally.)
4. Ask the assistant: *"Add JWT authentication"*, *"Fix the login bug"*,
   *"Convert project to Docker"*, *"Refactor UserService"*, etc.
5. Review the plan, approve tool calls / diffs, and let it iterate.

## Supported providers

OpenAI · Anthropic · Gemini · OpenRouter · Ollama · LM Studio · vLLM ·
Together · Groq · Fireworks · DeepSeek · Mistral · Azure OpenAI ·
any OpenAI-compatible endpoint.

Adding a provider that speaks the OpenAI dialect requires **zero code** — add
it in AI Settings with a base URL. A genuinely new wire protocol requires one
class implementing `AIProvider` plus one line in `providers/factory.ts`.

## Security

- API keys are encrypted at rest (AES-256-GCM) and never returned raw to the UI
  or written to logs.
- Destructive commands (`rm -rf`, `git reset --hard`, `docker prune`, DB drops,
  …) are classified and require explicit user approval in the UI before running.
- File edits are shown as diffs and gated behind approval.
- Path access is confined to the project root.

## Testing

```bash
npm run test          # server unit tests (node:test)
npm run typecheck     # type-check all workspaces
```

## Status & roadmap

**Implemented and working end-to-end:**
project selection · framework/metadata detection · incremental file indexing ·
symbol extraction · dependency graph & go-to-definition · embeddings +
semantic search (with an offline hash-embedding fallback) · context manager
with token budgeting and file summarization · planner · full tool-calling agent
loop with streaming · minimal-diff editing · terminal/test/build execution with
output fed back · git integration · encrypted multi-provider config · dynamic
model discovery · per-task routing + fallback chains · cost tracking · the
VS Code–style UI (explorer / editor / chat / terminal / plan / memory).

**Scaffolded with clear extension points (not fully built):**

- **Parser** — regex-based today; `SymbolParser` interface is ready for
  Tree-sitter / LSP without touching callers.
- **Vector store** — vectors live in SQLite with in-process cosine ranking;
  swap in Qdrant/pgvector behind `EmbeddingIndex` for very large repos.
- **Terminal** — uses `child_process` (captures stdout/stderr). A `node-pty`
  PTY can replace it for interactive programs.
- **Rename Symbol / full Find-References** — definition lookup works; project-
  wide rename refactoring is not yet applied automatically.
- **Editor** — read-only syntax-free viewer; Monaco can drop into `Editor.tsx`.
- **File watching (chokidar)** — index is refreshed on edits via the tools;
  a live watcher for external changes is a small addition.

These are deliberate scope cuts to keep the foundation coherent and installable,
not hidden gaps.
