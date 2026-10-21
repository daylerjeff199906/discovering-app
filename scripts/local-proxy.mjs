// Proxy de ORIGEN ÚNICO para el modo `pnpm preview` (equivale al Caddy de producción):
//   /api/*  → API (Nest)      el resto → servidor SSR de React Router
import http from "node:http";

const listen = Number(process.env.PREVIEW_PORT ?? process.env.WEB_PORT ?? 5173);
const api = { host: "127.0.0.1", port: Number(process.env.API_PORT ?? 4000) };
const web = { host: "127.0.0.1", port: Number(process.env.WEB_SSR_PORT ?? 3000) };

const server = http.createServer((req, res) => {
  const target = req.url?.startsWith("/api/") ? api : web;
  const upstream = http.request({ ...target, method: req.method, path: req.url, headers: { ...req.headers, host: req.headers.host } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "BAD_GATEWAY", message: "Servicio no disponible" }));
  });
  req.pipe(upstream);
});

server.listen(listen, () => console.log(`proxy http://localhost:${listen}  (/api → :${api.port}, resto → :${web.port})`));
