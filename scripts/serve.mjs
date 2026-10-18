// Standalone server, no Electron: this is what makes the Fire TV probe reachable (Checkpoint 1)
// before the desktop shell exists.
import { lanAddresses } from "../dist/server/lan.js";

let startServer;
try {
  ({ startServer } = await import("../dist/server/http.js"));
} catch (err) {
  console.error(`cannot load dist/server/http.js (${err.message})\nrun: npm run build`);
  process.exit(1);
}

const server = await startServer({ port: Number(process.env.PORT) || 4680 });
const addresses = lanAddresses();

console.log(`screenmirror server listening on port ${server.port}`);
console.log(`  this machine : http://127.0.0.1:${server.port}`);
for (const address of addresses) console.log(`  on the LAN   : http://${address}:${server.port}`);
if (addresses.length === 0) console.warn("  no LAN address found — check your network connection");
console.log(`\nprobe page (open it on the TV): http://${addresses[0] ?? "127.0.0.1"}:${server.port}/probe`);
