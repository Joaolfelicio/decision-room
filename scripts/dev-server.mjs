import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import roomHandler from "../netlify/functions/room.mts";

const PORT = Number(process.env.PORT || 5179);

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  const server = createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (parsedUrl.pathname === "/api/room") {
      try {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks);

        const webReq = new Request(parsedUrl.toString(), {
          method: req.method || "GET",
          headers: Object.entries(req.headers).reduce((acc, [k, v]) => {
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
        return;
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }));
        return;
      }
    }

    vite.middlewares(req, res);
  });

  server.listen(PORT, () => {
    console.log(
      `✓ Decision Room v1 Dev Server (Vite + /api/room Netlify Function) listening at http://localhost:${PORT}`
    );
  });
}

startServer();
