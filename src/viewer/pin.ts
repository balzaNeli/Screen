export const PIN_LENGTH = 6;

export type PadAction =
  | { type: "digit"; digit: string }
  | { type: "backspace" }
  | { type: "clear" };

/** Pure PIN-pad state machine: one source of truth for the buttons and their tests. */
export function reducePad(digits: string, action: PadAction): string {
  if (action.type === "backspace") return digits.slice(0, -1);
  if (action.type === "clear") return "";
  if (!/^[0-9]$/.test(action.digit) || digits.length >= PIN_LENGTH) return digits;
  return digits + action.digit;
}

export function isPinComplete(digits: string): boolean {
  return digits.length === PIN_LENGTH;
}

export type PinLink = { pin: string; path: string };

/** Read `?p=` once and return the URL without it; other query parameters survive. */
export function takePin(href: string): PinLink {
  const url = new URL(href);
  const raw = url.searchParams.get("p");
  if (raw === null) return { pin: "", path: url.pathname + url.search + url.hash };

  url.searchParams.delete("p");
  const search = url.searchParams.toString();
  return {
    pin: /^[0-9]{6}$/.test(raw) ? raw : "",
    path: url.pathname + (search === "" ? "" : `?${search}`) + url.hash,
  };
}
