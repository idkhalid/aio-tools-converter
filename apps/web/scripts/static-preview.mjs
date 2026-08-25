import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".gz", "application/gzip"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".xml", "application/xml; charset=utf-8"],
]);

export async function createStaticPreview({ root, host, port }) {
  const absoluteRoot = resolve(root);
  const rootPrefix = `${absoluteRoot}${sep}`;

  function safePath(relativePath) {
    const absolute = resolve(absoluteRoot, relativePath);
    return absolute === absoluteRoot || absolute.startsWith(rootPrefix) ? absolute : undefined;
  }

  async function existingFile(candidates) {
    for (const candidate of candidates) {
      const path = safePath(candidate);
      if (!path) continue;
      try {
        const details = await stat(path);
        if (details.isFile()) return { details, path };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }

      const requestURL = new URL(request.url ?? "/", `http://${host}:${port}`);
      let pathname;
      try {
        pathname = decodeURIComponent(requestURL.pathname);
      } catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
        return;
      }
      const relative = pathname.replace(/^\/+/, "");
      const candidates = pathname.endsWith("/")
        ? [`${relative}index.html`]
        : extname(relative)
          ? [relative]
          : [`${relative}/index.html`, `${relative}.html`];
      const requested = await existingFile(candidates);
      const selected = requested ?? (await existingFile(["404.html"]));

      if (!selected) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }

      const status = requested ? 200 : 404;
      response.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Length": selected.details.size,
        "Content-Type":
          contentTypes.get(extname(selected.path).toLowerCase()) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(selected.path).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Preview error");
      console.error(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
