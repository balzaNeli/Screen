import { networkInterfaces } from "node:os";

type InterfaceEntry = { address: string; family: string; internal: boolean };
export type InterfaceMap = Record<string, InterfaceEntry[] | undefined>;

const isUsable = (entry: InterfaceEntry): boolean =>
  entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.");

/**
 * The addresses the host window offers to a viewer: non-internal, non-link-local IPv4s, sorted
 * and deduped so the list does not jump around when an adapter wakes up.
 */
export function lanAddresses(interfaces: InterfaceMap = networkInterfaces()): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (isUsable(entry)) found.add(entry.address);
    }
  }
  return [...found].sort();
}
