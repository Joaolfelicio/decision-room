import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import roomHandler from "./netlify/functions/room.mts";

function attachApiMiddleware(
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
) {
  use(async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/room")) {
      next();
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);
      const fullUrl = `http://${req.headers.host || "localhost:5173"}${req.url}`;

      const webReq = new Request(fullUrl, {
        method: req.method || "GET",
        headers: Object.entries(req.headers).reduce<Record<string, string>>((acc, [k, v]) => {
          if (typeof v === "string") acc[k] = v;
          else if (Array.isArray(v)) acc[k] = v.join(", ");
          return acc;
        }, {}),
        body:
          req.method && req.method !== "GET" && req.method !== "HEAD" && rawBody.length > 0
            ? rawBody
            : undefined,
      });

      const webRes = await roomHandler(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });
      const text = await webRes.text();
      res.end(text);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }));
    }
  });
}

function localNetlifyApiPlugin(): Plugin {
  return {
    name: "local-netlify-room-api",
    configureServer(server) {
      attachApiMiddleware(server.middlewares.use.bind(server.middlewares));
    },
    configurePreviewServer(server) {
      attachApiMiddleware(server.middlewares.use.bind(server.middlewares));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localNetlifyApiPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
