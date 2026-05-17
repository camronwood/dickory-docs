import { useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import { useMarkdownEditorStore } from "../stores/markdownEditorStore";
import { useMarkdownEditorShortcuts } from "../hooks/useMarkdownEditorShortcuts";

export function MarkdownEditorPane() {
  useMarkdownEditorShortcuts();

  const content = useMarkdownEditorStore((s) => s.content);
  const contentSyncKey = useMarkdownEditorStore((s) => s.contentSyncKey);
  const path = useMarkdownEditorStore((s) => s.path);
  const updateContent = useMarkdownEditorStore((s) => s.updateContent);

  const [editor, setEditor] = useState<import("monaco-editor").editor.IStandaloneCodeEditor | null>(
    null
  );
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const modelRef = useRef<import("monaco-editor").editor.ITextModel | null>(null);
  const lastAppliedRef = useRef<number>(-1);
  const listenersRef = useRef<Array<{ dispose(): void }>>([]);

  useEffect(() => {
    return () => {
      for (const d of listenersRef.current) d.dispose();
      listenersRef.current = [];
      if (modelRef.current && !modelRef.current.isDisposed()) {
        modelRef.current.dispose();
      }
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor || !monacoRef.current || !path) return;

    const monaco = monacoRef.current;
    const syncKey = contentSyncKey;

    let model = modelRef.current;
    if (!model || model.isDisposed()) {
      const uri = monaco.Uri.parse(
        `dickory://${encodeURIComponent(path)}?v=${syncKey}`
      );
      model = monaco.editor.createModel(content, "markdown", uri);
      modelRef.current = model;
    } else if (syncKey !== lastAppliedRef.current && model.getValue() !== content) {
      model.setValue(content);
    }

    if (editor.getModel() !== model) {
      editor.setModel(model);
    }

    lastAppliedRef.current = syncKey;
  }, [editor, path, content, contentSyncKey]);

  const handleEditorDidMount = (
    ed: import("monaco-editor").editor.IStandaloneCodeEditor,
    monaco: typeof import("monaco-editor")
  ) => {
    monacoRef.current = monaco;
    setEditor(ed);

    for (const d of listenersRef.current) d.dispose();
    listenersRef.current = [];

    ed.updateOptions({
      minimap: { enabled: false },
      wordWrap: "on",
      lineNumbers: "on",
      folding: true,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true },
      fontSize: 14,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });

    const sub = ed.onDidChangeModelContent(() => {
      const m = ed.getModel();
      if (!m) return;
      const next = m.getValue();
      if (next === useMarkdownEditorStore.getState().content) return;
      updateContent(next);
    });
    listenersRef.current.push(sub);
  };

  if (!path) {
    return (
      <div className="flex items-center justify-center h-full text-slack-textMuted">
        <p className="text-sm">Select a Markdown file to edit</p>
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language="markdown"
      theme="vs-dark"
      defaultValue=""
      onMount={handleEditorDidMount}
      options={{
        theme: "vs-dark",
        minimap: { enabled: false },
        wordWrap: "on",
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
