import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const portalVersion = readFileSync(
  resolve(__dirname, "../VERSION"),
  "utf-8"
).trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __PORTAL_VERSION__: JSON.stringify(portalVersion),
  },
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
