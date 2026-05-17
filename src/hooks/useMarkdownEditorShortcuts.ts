import { useEffect, useCallback } from "react";
import { useMarkdownEditorStore } from "../stores/markdownEditorStore";

export function useMarkdownEditorShortcuts() {
  const save = useMarkdownEditorStore((s) => s.save);
  const isDirty = useMarkdownEditorStore((s) => s.isDirty);

  const handleKeyDown = useCallback(
    async (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdKey = isMac ? event.metaKey : event.ctrlKey;

      const target = event.target as HTMLElement;
      const inMonaco = Boolean(target.closest?.(".monaco-editor"));

      if (
        !inMonaco &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.contentEditable === "true")
      ) {
        return;
      }

      if (cmdKey && event.key === "s" && !event.shiftKey) {
        event.preventDefault();
        await save();
      }
    },
    [save]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
        event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
