"use client";

import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

const tokens = new MatchDecorator({
  regexp:
    /(?:^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?=\s*=))|(?:\{\{\s*(?:globals|source)\.[A-Za-z_][A-Za-z0-9_]*\s*\}\})/g,
  decoration: (match) =>
    Decoration.mark({
      class: match[0].includes("{{")
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-accent",
    }),
});
const highlighting = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = tokens.createDeco(view);
    }
    update(update: import("@codemirror/view").ViewUpdate) {
      this.decorations = tokens.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export default function SecretFileEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  const editable = useRef(new Compartment());
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlighting,
          drawSelection(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          editable.current.of(EditorState.readOnly.of(disabled)),
          EditorView.contentAttributes.of({
            "aria-label": "Secrets .env file",
            autocapitalize: "off",
            spellcheck: "false",
            "data-lpignore": "true",
            "data-1p-ignore": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              color: "var(--foreground)",
              backgroundColor: "var(--surface-secondary)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            },
            "&.cm-focused": {
              outline: "2px solid var(--focus)",
              outlineOffset: "2px",
            },
            ".cm-scroller": {
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "16px",
              lineHeight: "1.6",
              overflow: "auto",
              minHeight: "240px",
              maxHeight: "480px",
            },
            ".cm-content": {
              padding: "12px 0",
              caretColor: "var(--foreground)",
            },
            ".cm-line": { padding: "0 12px" },
            ".cm-gutters": {
              backgroundColor: "var(--surface-secondary)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine": { backgroundColor: "var(--surface-tertiary)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: "var(--accent-soft)",
            },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
    // The document is owned by this editor until file mode is closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);
  return <div ref={host} className="min-w-0" />;
}
