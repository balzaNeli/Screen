// Dev loop: rebuild the web bundles on change, run Electron against them.
// ponytail: no HMR (the viewer is served over the LAN from dist/, so a rebuild is the loop).
import { spawn } from "node:child_process";

const shell = process.platform === "win32";
const vite = spawn("npx", ["vite", "build", "--watch"], { stdio: "inherit", shell });
const electron = spawn("npx", ["electron", "."], { stdio: "inherit", shell });

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
