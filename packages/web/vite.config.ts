import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: "fx-config",
      configureServer(server) {
        server.middlewares.use("/config.js", (_req, res) => {
          const body = `window.__FX_CONFIG__ = ${JSON.stringify({
            apiUrl: process.env.VITE_API_URL ?? "",
            region: process.env.VITE_REGION ?? "eu-west-1",
            userPoolId: process.env.VITE_USER_POOL_ID ?? "",
            userPoolClientId: process.env.VITE_USER_POOL_CLIENT_ID ?? "",
          })};`;
          res.setHeader("content-type", "application/javascript");
          res.end(body);
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@fx/core": path.resolve(root, "../core/src"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(root, "../..")],
    },
  },
});
