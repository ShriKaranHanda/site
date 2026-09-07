import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { decodeIco, isIco } from "icojs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["around/index.html", "past/index.html", "press/index.html"];

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1].replaceAll("&amp;", "&");
}

export function sourcesFrom(html) {
  const sources = new Map();
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(tag, "href");
    if (!href?.startsWith("https://")) continue;
    const domain = new URL(href).hostname;
    const key = attribute(tag, "data-favicon") || domain;
    if (!/^[a-z0-9.-]+$/.test(key)) throw new Error(`Invalid favicon key: ${key}`);
    sources.set(key, { key, domain, pageURL: key === domain ? undefined : href });
  }
  return [...sources.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function faviconUrlFrom(html, pageURL) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("icon")) {
      const href = attribute(tag, "href");
      if (href) {
        const url = new URL(href, pageURL);
        if (url.protocol === "https:") return url.href;
      }
    }
  }
  throw new Error(`No favicon declared by ${pageURL}`);
}

export async function normalizeIcon(bytes) {
  if (isIco(bytes)) {
    const images = await decodeIco(bytes, "image/png");
    images.sort((a, b) => b.width * b.height - a.width * a.height);
    if (!images.length) throw new Error("ICO has no images");
    bytes = Buffer.from(images[0].buffer);
  }
  return sharp(bytes, { failOn: "warning", limitInputPixels: 16777216 })
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

export async function validatePng(bytes) {
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 16777216 });
  const metadata = await decoder.metadata();
  if (metadata.format !== "png") throw new Error("cached icon is not PNG");
  await decoder.raw().toBuffer();
}

export async function download(domain, { fetchImpl = fetch, pageURL } = {}) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let url = `https://icon.horse/icon/${domain}`;
      if (pageURL) {
        const page = await fetchImpl(pageURL, { signal: AbortSignal.timeout(15000) });
        if (!page.ok) throw new Error(`Project page: HTTP ${page.status}`);
        url = faviconUrlFrom(await page.text(), page.url || pageURL);
      }
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("service did not return an image");
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return await normalizeIcon(bytes);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

export async function syncFavicons({ directory = root, ref, fetchIcon = download } = {}) {
  const read = (path) => ref
    ? execFileSync("git", ["show", `${ref}:${path}`], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] })
    : readFile(resolve(directory, path));
  const html = await Promise.all(pages.map(async (path) => (await read(path)).toString()));
  const sources = sourcesFrom(html.join("\n"));
  const results = [];
  const failures = [];
  // Small batches avoid overwhelming the service. Do not overwrite any files on failure.
  for (let i = 0; i < sources.length; i += 3) {
    await Promise.all(sources.slice(i, i + 3).map(async ({ key, domain, pageURL }) => {
      try {
        const bytes = await fetchIcon(domain, { pageURL });
        await validatePng(bytes);
        results.push({ domain: key, bytes });
      } catch (error) {
        failures.push(`${key}: ${error.message}`);
      }
    }));
  }
  if (failures.length) throw new Error(`Favicon downloads failed:\n${failures.join("\n")}`);
  if (ref) {
    const stale = [];
    for (const { domain, bytes } of results) {
      try {
        const saved = await read(`images/favicons/${domain}.png`);
        await validatePng(saved);
        if (!saved.equals(bytes)) stale.push(domain);
      } catch {
        stale.push(domain);
      }
    }
    if (stale.length) {
      throw new Error(`Missing or outdated committed favicons: ${stale.join(", ")}\nRun node scripts/sync-favicons.mjs, commit images/favicons, then push again.`);
    }
  } else {
    await mkdir(resolve(directory, "images/favicons"), { recursive: true });
    for (const { domain, bytes } of results) {
      await writeFile(resolve(directory, `images/favicons/${domain}.png`), bytes);
    }
  }
  return sources.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--check-ref" || !/^[a-f0-9]{40,64}$/.test(args[1]))) {
    console.error("Usage: node scripts/sync-favicons.mjs [--check-ref COMMIT_SHA]");
    process.exitCode = 1;
  } else {
    try {
      const count = await syncFavicons({ ref: args[1] });
      console.log(`${args.length ? "Verified" : "Saved"} ${count} favicons.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
