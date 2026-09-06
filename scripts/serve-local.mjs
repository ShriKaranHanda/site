import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8000;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".bin": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".img": "application/octet-stream",
  ".iso": "application/octet-stream",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let filePath = resolve(root, `.${pathname}`);

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let details = await stat(filePath);
    if (details.isDirectory()) {
      filePath = join(filePath, "index.html");
      details = await stat(filePath);
    }

    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);

    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), details.size - 1) : details.size - 1;
      headers["Content-Length"] = String(end - start + 1);
      headers["Content-Range"] = `bytes ${start}-${end}/${details.size}`;
      response.writeHead(206, headers);
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    headers["Content-Length"] = String(details.size);
    response.writeHead(200, headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Local site: http://127.0.0.1:${port}`);
  console.log(`XP page: http://127.0.0.1:${port}/xp/`);
});
