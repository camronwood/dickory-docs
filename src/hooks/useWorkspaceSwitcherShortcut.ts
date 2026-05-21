import { useCallback, useEffect } from "react";

/** Block shortcut only in Monaco / contentEditable — allow from sidebar file search etc. */
function isShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".monaco-editor")) return true;
  return target.isContentEditable;
}

export function useWorkspaceSwitcherShortcut(
  onOpen: () => void,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      if (isShortcutBlockedTarget(event.target)) return;

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        onOpen();
      }
    },
    [onOpen, enabled]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
