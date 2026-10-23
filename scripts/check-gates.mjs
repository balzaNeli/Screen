import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const root = path.resolve(process.argv[2] ?? repoRoot);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css"]);
const ICE_PROPERTY = /iceServers\s*:/g;
const EMPTY_ICE = /^iceServers\s*:\s*(?:Object\.freeze\(\s*)?\[\s*\]/;
const VIEWER_FORBIDDEN = /getUserMedia|getDisplayMedia|navigator\.mediaDevices/g;

async function filesUnder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await filesUnder(full);
      if (nested !== null) files.push(...nested);
    } else if (TEXT_EXT.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const failures = [];
for (const dir of ["src", "dist"]) {
  const files = await filesUnder(path.join(root, dir));
  if (files === null) {
    failures.push(`${dir}/ is missing; run npm run build first`);
    continue;
  }
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(ICE_PROPERTY)) {
      const after = text.slice(match.index, match.index + 200);
      if (!EMPTY_ICE.test(after)) {
        failures.push(`${relative(file)}:${lineOf(text, match.index)}: iceServers must stay empty`);
      }
    }
  }
}

async function builtViewerFiles() {
  const html = path.join(root, "dist", "viewer", "index.html");
  let text;
  try {
    text = await readFile(html, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const files = new Set([html]);
  for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:[a-z]+:|\/\/)/i.test(ref)) continue;
    files.add(path.resolve(path.dirname(html), ref));
  }
  return [...files];
}

const viewerFiles = [];
const sourceViewer = await filesUnder(path.join(root, "src", "viewer"));
if (sourceViewer === null) failures.push("src/viewer/ is missing");
else viewerFiles.push(...sourceViewer);
const builtViewer = await builtViewerFiles();
if (builtViewer === null) failures.push("dist/viewer/index.html is missing; run npm run build first");
else viewerFiles.push(...builtViewer);

for (const file of viewerFiles) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    failures.push(`${relative(file)}: cannot read (${err.code})`);
    continue;
  }
  for (const match of text.matchAll(VIEWER_FORBIDDEN)) {
    failures.push(
      `${relative(file)}:${lineOf(text, match.index)}: viewer is receive-only (found ${match[0]})`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("gates ok: no STUN/TURN servers; viewer is receive-only");
}
