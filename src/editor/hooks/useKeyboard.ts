import { useEffect } from "react";

interface KeyboardShortcutsOptions {
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onDeselect?: () => void;
}

export function useKeyboard({
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
  onDeselect,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events when typing inside inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          onRedo?.();
        } else {
          e.preventDefault();
          onUndo?.();
        }
      } else if (cmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        onRedo?.();
      } else if (cmdOrCtrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onDuplicate?.();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDelete?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDeselect?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo, onDelete, onDuplicate, onDeselect]);
}
