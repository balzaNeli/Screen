import assert from "node:assert/strict";
import test from "node:test";

import { lanAddresses, type InterfaceMap } from "../src/server/lan.ts";

const entry = (address: string, family = "IPv4", internal = false) => ({ address, family, internal });

test("offers only reachable LAN addresses", () => {
  const interfaces: InterfaceMap = {
    "Wi-Fi": [entry("192.168.1.23"), entry("fe80::a1b2", "IPv6")],
    Ethernet: [entry("10.0.0.7"), entry("169.254.12.9")],
    "Loopback Pseudo-Interface 1": [entry("127.0.0.1", "IPv4", true)],
    "vEthernet (WSL)": undefined,
    Bluetooth: [],
    "Wi-Fi 2": [entry("192.168.1.23")],
  };

  assert.deepEqual(lanAddresses(interfaces), ["10.0.0.7", "192.168.1.23"]);
});

test("says nothing rather than something wrong when there is no network", () => {
  assert.deepEqual(lanAddresses({}), []);
  assert.deepEqual(lanAddresses({ Loopback: [entry("127.0.0.1", "IPv4", true)] }), []);
});
