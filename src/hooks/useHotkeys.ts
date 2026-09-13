import { useEffect } from "react";

export type HotkeyMap = Partial<Record<"F2" | "F3" | "F5" | "F9" | "F10" | "Escape", (e: KeyboardEvent) => void>>;

/**
 * Global function-key bindings. Function keys fire even while an input is
 * focused so operators never have to reach for the mouse.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const fn = map[e.key as keyof HotkeyMap];
      if (!fn) return;
      if (e.key === "Escape") {
        fn(e);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [map, enabled]);
}
