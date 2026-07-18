import express from "express";
import cors from "cors";
import http from "node:http";
import { api } from "./api/routes.js";
import { attachWebSocket } from "./api/ws.js";
import { db } from "./core/db.js";
import { seedDefaultProviders } from "./bootstrap.js";

const PORT = Number(process.env.PORT ?? 4319);

function main(): void {
  db(); // initialise + migrate
  seedDefaultProviders();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.get("/health", (_req, res) => res.json({ ok: true, service: "amarcode", version: "0.1.0" }));
  app.use("/api", api);

  const server = http.createServer(app);
  attachWebSocket(server);

  server.listen(PORT, () => {
    console.log(`\n  AmarCode engine listening on http://localhost:${PORT}`);
    console.log(`  WebSocket:  ws://localhost:${PORT}/ws\n`);
  });
}

main();
