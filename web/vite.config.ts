import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      "/api": "http://localhost:4319",
      "/ws": { target: "ws://localhost:4319", ws: true },
    },
  },
});
