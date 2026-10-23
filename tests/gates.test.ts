import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const GATE = fileURLToPath(new URL("../scripts/check-gates.mjs", import.meta.url));

const CLEAN = {
  "src/shared/rtc.ts": "export const RTC_CONFIG = { iceServers: Object.freeze([]) };\n",
  "src/viewer/main.ts": "export const ok = true;\n",
  "dist/shared/rtc.js": "export const RTC_CONFIG = { iceServers: [] };\n",
  "dist/viewer/index.html":
    '<script type="module" src="../assets/viewer-test.js"></script>\n',
  "dist/assets/viewer-test.js": 'console.log("ok");\n',
};

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "screenmirror-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [GATE, root], { encoding: "utf8" });
}

test("gate accepts empty iceServers and a receive-only viewer", async (t) => {
  const root = await fixture(t, CLEAN);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gates ok/);
});

test("gate rejects a STUN server in source or built output", async (t) => {
  const root = await fixture(t, {
    ...CLEAN,
    "src/shared/rtc.ts": 'export const RTC_CONFIG = { iceServers: [{ urls: "stun:evil.example" }] };\n',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/shared\/rtc\.ts:\d+: iceServers must stay empty/);
});

test("gate rejects viewer capture APIs", async (t) => {
  const root = await fixture(t, {
    ...CLEAN,
    "src/viewer/main.ts": "navigator.mediaDevices.getUserMedia({ audio: true });\n",
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/viewer\/main\.ts:\d+: viewer is receive-only/);
});

test("gate rejects capture APIs in the built viewer bundle", async (t) => {
  const root = await fixture(t, {
    ...CLEAN,
    "dist/assets/viewer-test.js": "navigator.mediaDevices.getDisplayMedia();\n",
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist\/assets\/viewer-test\.js:\d+: viewer is receive-only/);
});
