import { useEffect, useRef, useState } from "react";

import { PIN_LENGTH, isPinComplete, reducePad } from "./pin.ts";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type PinPadProps = {
  initialPin: string;
  error: string | null;
  lockedUntilMs: number;
  busy: boolean;
  onSubmit: (pin: string) => Promise<boolean>;
};

export function PinPad({ initialPin, error, lockedUntilMs, busy, onSubmit }: PinPadProps) {
  const [digits, setDigits] = useState(initialPin);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [focusTick, setFocusTick] = useState(0);
  const firstRef = useRef<HTMLButtonElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNow(Date.now());
    if (lockedUntilMs <= Date.now()) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= lockedUntilMs) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [lockedUntilMs]);

  useEffect(() => {
    if (initialPin.length === PIN_LENGTH) connectRef.current?.focus();
    else firstRef.current?.focus();
  }, [initialPin]);

  // A failed attempt clears the pad; move focus back only after React has re-enabled the keys.
  useEffect(() => {
    if (focusTick > 0) firstRef.current?.focus();
  }, [focusTick]);

  const remainingMs = Math.max(0, lockedUntilMs - now);
  const locked = remainingMs > 0;
  const disabled = locked || busy || submitting;

  async function submit(candidate: string): Promise<void> {
    if (disabled || !isPinComplete(candidate)) return;
    setSubmitting(true);
    let accepted = false;
    try {
      accepted = await onSubmit(candidate);
    } catch {
      accepted = false;
    }
    if (accepted) return; // the parent swaps this screen for the stream
    setSubmitting(false);
    setDigits("");
    setFocusTick((tick) => tick + 1);
  }

  function press(digit: string): void {
    if (disabled) return;
    const next = reducePad(digits, { type: "digit", digit });
    if (next === digits) return;
    setDigits(next);
    if (isPinComplete(next)) void submit(next);
  }

  function backspace(): void {
    if (disabled) return;
    setDigits((current) => reducePad(current, { type: "backspace" }));
  }

  return (
    <section className="pinpad" aria-label="PIN entry">
      <div className="pin-slots" role="status" aria-label={`${digits.length} of ${PIN_LENGTH} digits`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} className={index < digits.length ? "pin-slot is-filled" : "pin-slot"}>
            {digits[index] ?? ""}
          </span>
        ))}
      </div>

      {error !== null && (
        <p className="pin-error" role="alert">
          {error}
        </p>
      )}
      {locked && (
        <p className="pin-lock" role="status">
          Too many attempts. Try again in {Math.ceil(remainingMs / 1000)} s.
        </p>
      )}

      <div className="pin-keys">
        {DIGITS.map((digit, index) => (
          <button
            key={digit}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            className="pin-key"
            disabled={disabled}
            onClick={() => press(digit)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="pin-key"
          aria-label="Delete last digit"
          disabled={disabled || digits.length === 0}
          onClick={backspace}
        >
          ⌫
        </button>
        <button type="button" className="pin-key" disabled={disabled} onClick={() => press("0")}>
          0
        </button>
        <button
          ref={connectRef}
          type="button"
          className="pin-key pin-connect"
          disabled={disabled || !isPinComplete(digits)}
          onClick={() => void submit(digits)}
        >
          {busy || submitting ? "Connecting" : "Connect"}
        </button>
      </div>
    </section>
  );
}
