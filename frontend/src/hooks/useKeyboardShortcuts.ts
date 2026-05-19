import { useEffect } from "react";
import { useStore } from "../store";
import { runExport } from "../exportConfig";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const state = useStore.getState();
      const shift = e.shiftKey;
      const cmd = e.metaKey || e.ctrlKey;

      // Chord shortcuts handled before the single-key switch.
      if (cmd && e.code === "KeyZ") {
        e.preventDefault();
        if (shift) state.redo(); else state.undo();
        return;
      }
      if (cmd && e.code === "KeyY") {
        e.preventDefault();
        state.redo();
        return;
      }
      // Cmd/Ctrl-S → Export (re-uses cached FSA handle if any).
      // Cmd/Ctrl-Shift-S → Save As (re-prompts the FSA picker).
      // Override the browser's save-page default in both cases.
      if (cmd && e.code === "KeyS") {
        e.preventDefault();
        runExport({ forcePicker: shift });
        return;
      }
      // `?` (Shift+/) toggles the help overlay; bare `/` opens it for
      // layouts where Shift+/ produces a different code.
      if (e.code === "Slash") {
        e.preventDefault();
        state.toggleHelp();
        return;
      }

      // Help overlay swallows the rest — only Esc / H close it, and the
      // chord-shortcuts above still apply.
      if (state.helpOpen) {
        if (e.code === "Escape" || e.code === "KeyH") {
          e.preventDefault();
          state.setHelpOpen(false);
        }
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          state.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          state.setCurrentFrame(Math.max(0, state.currentFrame - (shift ? 10 : 1)));
          break;
        case "ArrowRight":
          e.preventDefault();
          state.setCurrentFrame(Math.min(state.acmNumFrames - 1, state.currentFrame + (shift ? 10 : 1)));
          break;
        case "Home":
          e.preventDefault();
          state.setCurrentFrame(0);
          break;
        case "End":
          e.preventDefault();
          state.setCurrentFrame(Math.max(0, state.acmNumFrames - 1));
          break;
        case "Digit1":
          state.setMode("mapping");
          break;
        case "Digit2":
          state.setMode("offset");
          break;
        case "Escape":
          if (state.helpOpen) state.setHelpOpen(false);
          else state.setSelectedKeypoint(null);
          break;
        case "KeyH":
          state.toggleHelp();
          break;
        case "KeyL":
          state.labelCurrentFrame();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
