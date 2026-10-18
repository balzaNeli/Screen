// Standalone server, no Electron: this is what makes the Fire TV probe reachable (Checkpoint 1)
// and what lets pairing be tested with curl (Task 6) before the host window exists.
import { lanAddresses } from "../dist/server/lan.js";

let startServer;
let createPairing;
try {
  ({ startServer } = await import("../dist/server/http.js"));
  ({ createPairing } = await import("../dist/server/pairing.js"));
} catch (err) {
  console.error(`cannot load dist/server/http.js (${err.message})\nrun: npm run build`);
  process.exit(1);
}

const pairing = createPairing();
const server = await startServer({ port: Number(process.env.PORT) || 4680, pairing });
const addresses = lanAddresses();

console.log(`screenmirror server listening on port ${server.port}`);
console.log(`  this machine : http://127.0.0.1:${server.port}`);
for (const address of addresses) console.log(`  on the LAN   : http://${address}:${server.port}`);
if (addresses.length === 0) console.warn("  no LAN address found - check your network connection");

// This terminal is the host operator's, the same place the host window will show the PIN.
// Nothing served over the LAN ever contains it. ASCII only in here: this console is piped,
// redirected and screenshotted on a Windows codepage that turns em-dashes into mojibake.
const { pin } = pairing.status();
console.log(`\nPIN: ${pin}  (rotates every 60 s - restart for a fresh one)`);
console.log(`probe page (open it on the TV): http://${addresses[0] ?? "127.0.0.1"}:${server.port}/probe`);
