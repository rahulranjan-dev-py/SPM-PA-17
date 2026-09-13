import { useEffect, useRef } from "react";
import { WedgeDetector } from "@/lib/wedge";

/**
 * Listens to every keystroke in the window and reports scanner bursts.
 * The burst characters are also removed from whichever input had focus
 * (a wedge scanner types into it), unless that input opted in via
 * `data-accepts-scan`.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled = true): void {
  const detector = useRef(new WedgeDetector());
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    const d = detector.current;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const acceptsScan = !!target?.closest?.("[data-accepts-scan]");
      const result = d.feed(e.key, performance.now());
      if (result) {
        e.preventDefault();
        if (!acceptsScan && target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
          // strip the scanned characters the scanner typed into the focused field
          const v = target.value;
          if (v.endsWith(result.code)) {
            const nativeSetter = Object.getOwnPropertyDescriptor(target.constructor.prototype, "value")?.set;
            nativeSetter?.call(target, v.slice(0, -result.code.length));
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        cb.current(result.code);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
