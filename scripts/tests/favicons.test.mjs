import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { encodeIco } from "icojs";
import { sourcesFrom, faviconUrlFrom, download, normalizeIcon, syncFavicons, validatePng } from "../sync-favicons.mjs";

const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: "red" } }).png().toBuffer();
const hook = fileURLToPath(new URL("../../.githooks/pre-push", import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "favicon-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const page of ["around", "past", "press"]) {
    await mkdir(resolve(directory, page));
    await writeFile(resolve(directory, page, "index.html"), '<a href="https://example.com/article">Example</a>');
  }
  return directory;
}

test("extracts unique domains, excluding internal links", () => {
  assert.deepEqual(sourcesFrom('<a href="/">Home</a><a href="https://example.com/a">A</a><a href="https://example.com/b">B</a>').map(s => s.key), ["example.com"]);
});

test("separates projects sharing a domain and discovers relative icons after redirects", async () => {
  const sources = sourcesFrom('<a href="https://example.com/one" data-favicon="one">One</a><a href="https://example.com/two" data-favicon="two">Two</a>');
  assert.deepEqual(sources.map(s => s.key), ["one", "two"]);
  assert.equal(sources[0].pageURL, "https://example.com/one");
  assert.equal(faviconUrlFrom('<link href="icon.png?v=1&amp;x=2" rel="shortcut icon">', "https://project.example/app/"), "https://project.example/app/icon.png?v=1&x=2");
  assert.throws(() => faviconUrlFrom("<html></html>", "https://example.com"), /No favicon/);
  const calls = [];
  await download("example.com", { pageURL: "https://example.com/two", fetchImpl: async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return { ok: true, url: "https://project.example/", text: async () => '<link rel="icon" href="/icon.png">' };
    }
    return new Response(png, { headers: { "content-type": "image/png" } });
  } });
  assert.deepEqual(calls, ["https://example.com/two", "https://project.example/icon.png"]);
});

test("decodes PNG, SVG and ICO into browser-readable PNGs", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
  const ico = Buffer.from(await encodeIco([{ buffer: png }]));
  for (const bytes of [png, svg, ico]) {
    const image = await normalizeIcon(bytes);
    await validatePng(image);
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.width, 32);
    assert.equal(metadata.height, 32);
  }
  await assert.rejects(normalizeIcon(Buffer.from("<html>Error</html>")));
  await assert.rejects(validatePng(png.subarray(0, 40)));
});

test("retries temporary failures and rejects errors or HTML with HTTP 200", async () => {
  let attempts = 0;
  const image = await download("example.com", { fetchImpl: async () => {
    attempts++;
    if (attempts < 3) throw new Error("temporary outage");
    return new Response(png, { headers: { "content-type": "image/png" } });
  } });
  await validatePng(image);
  assert.equal(attempts, 3);
  for (const response of [() => new Response("unavailable", { status: 503 }), () => new Response("<html>Error</html>", { headers: { "content-type": "text/html" } })]) {
    let calls = 0;
    await assert.rejects(download("example.com", { fetchImpl: async () => { calls++; return response(); } }));
    assert.equal(calls, 3);
  }
});

test("keeps cached files untouched if any domain fails", async (t) => {
  const directory = await fixture(t);
  await syncFavicons({ directory, fetchIcon: async () => png });
  await writeFile(resolve(directory, "press/index.html"), '<a href="https://broken.example/">Broken</a>');
  await assert.rejects(syncFavicons({ directory, fetchIcon: async (domain) => {
    if (domain === "broken.example") throw new Error("timeout");
    return normalizeIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'));
  } }), /broken.example: timeout/);
  assert.deepEqual(await readFile(resolve(directory, "images/favicons/example.com.png")), png);
});

test("checks committed assets and links at the pushed revision, not the working tree", async (t) => {
  const directory = await fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Favicon Test");
  git("config", "user.email", "test@example.com");
  git("add", ".");
  git("commit", "-qm", "test: pages without icons");
  const missingRef = git("rev-parse", "HEAD");
  await syncFavicons({ directory, fetchIcon: async () => png });
  git("add", ".");
  git("commit", "-qm", "test: icons");
  const ref = git("rev-parse", "HEAD");
  await writeFile(resolve(directory, "around/index.html"), '<a href="https://uncommitted.example/">New</a>');
  assert.equal(await syncFavicons({ directory, ref, fetchIcon: async (domain) => { assert.equal(domain, "example.com"); return png; } }), 1);
  await assert.rejects(syncFavicons({ directory, ref: missingRef, fetchIcon: async () => png }), /Missing or outdated/);
  const blue = await sharp({ create: { width: 32, height: 32, channels: 4, background: "blue" } }).png().toBuffer();
  await assert.rejects(syncFavicons({ directory, ref, fetchIcon: async () => blue }), /Missing or outdated/);
});

test("pre-push blocks main on validation failure, allows success and skips other targets", async (t) => {
  const directory = await fixture(t);
  execFileSync("git", ["init", "-q"], { cwd: directory });
  const bin = resolve(directory, "bin");
  await mkdir(bin);
  await writeFile(resolve(bin, "node"), '#!/bin/sh\nprintf "%s\\n" "$@" > hook-args\nexit "${VALIDATOR_EXIT:-0}"\n', { mode: 0o755 });
  const sha = "a".repeat(40);
  const zero = "0".repeat(40);
  const run = (input, code) => spawnSync("sh", [hook], {
    cwd: directory, input, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VALIDATOR_EXIT: String(code) },
  });
  assert.equal(run(`refs/heads/topic ${sha} refs/heads/main ${zero}\n`, 1).status, 1);
  assert.equal(run(`refs/heads/topic ${sha} refs/heads/main ${zero}\n`, 0).status, 0);
  assert.equal(await readFile(resolve(directory, "hook-args"), "utf8"), `scripts/sync-favicons.mjs\n--check-ref\n${sha}\n`);
  assert.equal(run(`refs/heads/main ${sha} refs/heads/topic ${zero}\n`, 1).status, 0);
  assert.equal(run(`(delete) ${zero} refs/heads/main ${sha}\n`, 1).status, 0);
});
