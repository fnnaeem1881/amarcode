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
import * as gitSvc from "./gitService.js";
import * as fsBrowse from "./fsBrowse.js";
import * as devServer from "../tools/devServer.js";
import * as imageEngines from "../tools/imageEngines.js";

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

api.post("/project/file/save", (req, res) => {
  const { root: r, path: rel, content } = req.body as { root: string; path: string; content: string };
  try {
    const abs = resolveInRoot(r, rel);
    fs.writeFileSync(abs, content ?? "", "utf8");
    indexer.reindexFile(r, abs);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
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

api.get("/sessions/all", (_req, res) => res.json(sessions.listAllSessions()));
api.get("/sessions", (req, res) => res.json(sessions.listSessions(String(req.query.root ?? ""))));
api.delete("/sessions/:id", (req, res) => { sessions.deleteSession(req.params.id); res.json({ ok: true }); });
api.post("/sessions", (req, res) => {
  const m = req.body.mode;
  res.json(sessions.createSession(req.body.root ?? "", req.body.title, req.body.kind === "home" ? "home" : "code",
    m === "image" || m === "video" ? m : "chat"));
});
api.get("/sessions/:id/messages", (req, res) => res.json(sessions.getMessages(req.params.id)));
// Append a message directly (used by composer-driven image generation, which
// runs over REST rather than the chat WebSocket, so its turns still persist).
api.post("/sessions/:id/messages", (req, res) => {
  const { role, content, images } = req.body as { role?: string; content?: string; images?: string[] };
  const r = (role === "assistant" || role === "user" || role === "tool" || role === "system") ? role : "user";
  res.json(sessions.addMessage(req.params.id, { role: r, content: String(content ?? ""), images: Array.isArray(images) ? images : undefined }));
});
api.post("/sessions/:id/model", (req, res) => {
  sessions.setSessionModel(req.params.id, req.body.providerId, req.body.model);
  res.json({ ok: true });
});
api.post("/sessions/:id/title", (req, res) => {
  sessions.renameSession(req.params.id, String(req.body.title ?? "").slice(0, 80));
  res.json({ ok: true });
});
api.post("/sessions/:id/mode", (req, res) => {
  const m = req.body.mode;
  sessions.setSessionMode(req.params.id, m === "image" || m === "video" ? m : "chat");
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

/* ----------------------------------- Git --------------------------------- */

const root = (req: any) => String(req.query.root ?? req.body?.root ?? "");

api.get("/git/status", async (req, res) => {
  try { res.json(await gitSvc.status(root(req))); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.get("/git/diff", async (req, res) => {
  try { res.json({ diff: await gitSvc.diff(root(req), req.query.path ? String(req.query.path) : undefined, req.query.staged === "true") }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.get("/git/branches", async (req, res) => {
  try { res.json(await gitSvc.branches(root(req))); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.get("/git/log", async (req, res) => {
  try { res.json(await gitSvc.log(root(req))); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/init", async (req, res) => {
  try { await gitSvc.initRepo(root(req)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/stage", async (req, res) => {
  try { req.body.all ? await gitSvc.stageAll(root(req)) : await gitSvc.stage(root(req), req.body.path); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/unstage", async (req, res) => {
  try { await gitSvc.unstage(root(req), req.body.path); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/commit", async (req, res) => {
  try { res.json(await gitSvc.commit(root(req), req.body.message, req.body.addAll !== false)); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/checkout", async (req, res) => {
  try { await gitSvc.checkout(root(req), req.body.ref); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
api.post("/git/branch", async (req, res) => {
  try { await gitSvc.createBranch(root(req), req.body.name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});
// Destructive — requires explicit confirm flag from the UI.
api.post("/git/discard", async (req, res) => {
  if (!req.body.confirm) return res.status(400).json({ error: "confirmation required for discard" });
  try { await gitSvc.discard(root(req), req.body.path); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: msg(e) }); }
});

/* --------------------------------- Preview ------------------------------- */

api.get("/preview/status", (req, res) => res.json(devServer.serverStatus(root(req))));
api.post("/preview/start", async (req, res) => {
  const { root: r, command } = req.body as { root: string; command: string };
  devServer.startServer(r, command);
  const url = await devServer.waitForUrl(r);
  res.json({ ...devServer.serverStatus(r), url });
});
api.post("/preview/stop", (req, res) => { devServer.stopServer(root(req)); res.json({ ok: true }); });

/* ------------------------------ Image generation ------------------------- */

// Free image engines (no credit card) + any configured chat provider's image models.
api.get("/image/engines", (_req, res) => res.json(imageEngines.IMAGE_MODELS));

api.post("/image/generate", async (req, res) => {
  const { engine, providerId, model, prompt, image } = req.body as { engine?: string; providerId?: string; model: string; prompt: string; image?: string };
  try {
    let images: string[];
    if (engine) {
      images = await imageEngines.generateImage(engine as any, model, prompt, image || undefined);
    } else {
      const provider: any = createProvider(configStore.getProvider(providerId!)!);
      if (typeof provider.generateImages !== "function") {
        return res.status(400).json({ error: "This provider does not support image generation." });
      }
      images = await provider.generateImages(prompt, model);
    }
    if (!images.length) return res.status(502).json({ error: "The model returned no image. Try another model." });
    res.json({ images });
  } catch (e) {
    res.status(500).json({ error: msg(e) });
  }
});

/* ---------------------------------- Cost --------------------------------- */

api.get("/cost", (_req, res) => res.json(costSummary()));

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/* -------------------------------- Browse --------------------------------- */

// Directory browser for the project picker: drives/roots + robust listing.
api.get("/fs/roots", (_req, res) => res.json({ roots: fsBrowse.roots(), home: fsBrowse.homeDir() }));

api.get("/fs/list", (req, res) => {
  try {
    res.json(fsBrowse.list(req.query.dir ? String(req.query.dir) : undefined));
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

// Validate a typed/selected path before opening it as a project.
api.get("/fs/validate", (req, res) => {
  const p = String(req.query.path ?? "");
  try {
    const st = fs.statSync(p);
    res.json({ valid: st.isDirectory(), isDirectory: st.isDirectory(), path: p });
  } catch {
    res.json({ valid: false, isDirectory: false, path: p });
  }
});
