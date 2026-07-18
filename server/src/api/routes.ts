import { Router } from "express";
import fs from "node:fs";
import { nanoid } from "nanoid";
import type { ProviderConfig } from "@amarcode/shared";
import { configStore } from "../providers/configStore.js";
import { router as providerRouter } from "../providers/router.js";
import { createProvider, defaultConfigFor } from "../providers/factory.js";
import { scanProject, getStoredMetadata } from "../scanner/scanner.js";
import { indexer } from "../indexer/indexer.js";
import { graph } from "../indexer/graph.js";
import { embeddingIndex } from "../context/embeddings.js";
import { resolveInRoot } from "../tools/context.js";
import { createPlan } from "../agent/planner.js";
import * as sessions from "../agent/sessions.js";
import { costSummary } from "../agent/cost.js";
import { getMemory, saveMemory, ensureMemory } from "../agent/memory.js";
import { toolRegistry } from "../tools/registry.js";

export const api = Router();

/* ------------------------------- Providers ------------------------------- */

api.get("/providers", (_req, res) => res.json(configStore.listSafe()));

api.post("/providers", (req, res) => {
  const body = req.body as Partial<ProviderConfig>;
  if (!body.kind) return res.status(400).json({ error: "kind is required" });
  const cfg: ProviderConfig = {
    id: body.id ?? nanoid(),
    ...defaultConfigFor(body.kind),
    ...body,
  } as ProviderConfig;
  res.json(configStore.upsertProvider(cfg));
});

api.delete("/providers/:id", (req, res) => {
  configStore.deleteProvider(req.params.id);
  res.json({ ok: true });
});

api.post("/providers/:id/test", async (req, res) => {
  const cfg = configStore.getProvider(req.params.id);
  if (!cfg) return res.status(404).json({ error: "not found" });
  const result = await createProvider(cfg).healthCheck();
  res.json(result);
});

api.get("/providers/:id/models", async (req, res) => {
  const cfg = configStore.getProvider(req.params.id);
  if (!cfg) return res.status(404).json({ error: "not found" });
  try {
    res.json(await createProvider(cfg).listModels());
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.get("/routing", (_req, res) => res.json(configStore.getRouting()));
api.post("/routing", (req, res) => { configStore.setRouting(req.body); res.json({ ok: true }); });

api.get("/settings/:key", (req, res) => res.json({ value: configStore.getSetting(req.params.key, null) }));
api.post("/settings/:key", (req, res) => { configStore.setSetting(req.params.key, req.body.value); res.json({ ok: true }); });

/* -------------------------------- Project -------------------------------- */

api.post("/project/scan", (req, res) => {
  const { root } = req.body as { root: string };
  if (!root || !fs.existsSync(root)) return res.status(400).json({ error: "invalid root" });
  res.json(scanProject(root));
});

api.get("/project/metadata", (req, res) => {
  const root = String(req.query.root ?? "");
  const meta = getStoredMetadata(root);
  meta ? res.json(meta) : res.status(404).json({ error: "not scanned" });
});

api.post("/project/index", async (req, res) => {
  const { root } = req.body as { root: string };
  if (!root || !fs.existsSync(root)) return res.status(400).json({ error: "invalid root" });
  const stats = await indexer.indexProject(root);
  graph.build(root);
  res.json(stats);
});

api.get("/project/index/stats", (_req, res) => res.json(indexer.getStats()));

api.post("/project/embed", async (req, res) => {
  const { root } = req.body as { root: string };
  // Fire-and-forget: embedding runs in the background.
  embeddingIndex.embedProject(root).catch((e) => console.error("[embed]", e));
  res.json({ ok: true, started: true });
});

api.get("/project/files", (req, res) => {
  const root = String(req.query.root ?? "");
  res.json(indexer.listEntries(root).map((e) => ({
    path: e.path, language: e.language, size: e.size, symbols: e.symbols.length, importance: e.importance,
  })));
});

api.get("/project/file", (req, res) => {
  const root = String(req.query.root ?? "");
  const rel = String(req.query.path ?? "");
  try {
    const abs = resolveInRoot(root, rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "not found" });
    res.json({ path: rel, content: fs.readFileSync(abs, "utf8") });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* --------------------------------- Graph --------------------------------- */

api.get("/graph/definitions", (req, res) => {
  graph.build(String(req.query.root ?? ""));
  res.json(graph.definitions(String(req.query.name ?? "")));
});
api.get("/graph/references", (req, res) => {
  const root = String(req.query.root ?? "");
  graph.build(root);
  res.json(graph.references(root, String(req.query.name ?? "")));
});
api.get("/graph/edges", (req, res) => {
  graph.build(String(req.query.root ?? ""));
  res.json(graph.getEdges());
});

/* ------------------------------- Sessions -------------------------------- */

api.get("/sessions", (req, res) => res.json(sessions.listSessions(String(req.query.root ?? ""))));
api.post("/sessions", (req, res) => res.json(sessions.createSession(req.body.root, req.body.title)));
api.get("/sessions/:id/messages", (req, res) => res.json(sessions.getMessages(req.params.id)));
api.post("/sessions/:id/model", (req, res) => {
  sessions.setSessionModel(req.params.id, req.body.providerId, req.body.model);
  res.json({ ok: true });
});

/* -------------------------------- Planner -------------------------------- */

api.post("/plan", async (req, res) => {
  const { sessionId, root, task } = req.body as { sessionId: string; root: string; task: string };
  try {
    res.json(await createPlan(sessionId, root, task));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* --------------------------------- Tools --------------------------------- */

api.get("/tools", (_req, res) => res.json(toolRegistry.descriptors()));

/* --------------------------------- Memory -------------------------------- */

api.get("/memory", (req, res) => res.json(getMemory(String(req.query.root ?? "")) ?? null));
api.post("/memory", (req, res) => {
  const mem = ensureMemory(req.body.projectRoot);
  saveMemory({ ...mem, ...req.body });
  res.json({ ok: true });
});

/* ---------------------------------- Cost --------------------------------- */

api.get("/cost", (_req, res) => res.json(costSummary()));

/* -------------------------------- Browse --------------------------------- */

// Lightweight directory browser so the UI can let users pick a project folder.
api.get("/fs/list", (req, res) => {
  const dir = String(req.query.dir ?? (process.platform === "win32" ? "C:\\" : "/"));
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !n.startsWith("."))
      .sort();
    res.json({ dir, entries });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
