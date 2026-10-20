/**
 * The QR must point at an address the viewer can reach, with the current PIN in the query string.
 * The viewer reads and scrubs `p` on load (`src/viewer/pin.ts`).
 */
export function primaryUrl(urls: readonly string[]): string | null {
  return urls[0] ?? null;
}

export function pairUrl(base: string, pin: string): string {
  const url = new URL(base);
  url.searchParams.set("p", pin);
  return url.href;
}
