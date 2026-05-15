import { useState, useEffect } from "react";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import {
  loadMarkdownOnlyPreference,
  saveMarkdownOnlyPreference,
} from "./config/markdownFilterPreference";
import { useFileExplorerStore } from "./stores/fileExplorerStore";

type Selection =
  | null
  | { kind: "markdown"; workspaceId: string; path: string }
  | { kind: "text"; workspaceId: string; path: string; content: string };

function TextFileView({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const name = path.split("/").pop() || path;
  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-slack-bg">
      <div className="flex-shrink-0 bg-slack-bgHover border-b border-slack-border px-4 py-3">
        <h1 className="font-bold text-slack-text truncate">{name}</h1>
        <p className="text-sm text-slack-textMuted truncate">{path}</p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <pre className="text-sm text-slack-text font-mono whitespace-pre-wrap break-words bg-slack-bgHover border border-slack-border rounded p-4">
          {content}
        </pre>
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slack-bg text-slack-textMuted p-8 min-h-0">
      <div className="text-4xl mb-4">📄</div>
      <p className="text-center max-w-md">
        Select a Markdown file to preview, or any other file for plain text. Add a folder as a workspace; paths and file reads run locally in the app (no separate server).
      </p>
    </div>
  );
}

export default function App() {
  const [selection, setSelection] = useState<Selection>(null);
  const [markdownOnly, setMarkdownOnly] = useState(loadMarkdownOnlyPreference);

  const markdownWorkspaceRoot = useFileExplorerStore((s) => {
    if (!selection || selection.kind !== "markdown") return "";
    return s.workspaces.find((w) => w.id === selection.workspaceId)?.path ?? "";
  });

  useEffect(() => {
    saveMarkdownOnlyPreference(markdownOnly);
  }, [markdownOnly]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get("preview") === "true";
    const workspaceId = params.get("workspace");
    const filePath = params.get("path");
    if (isPreview && workspaceId && filePath) {
      setSelection({ kind: "markdown", workspaceId, path: filePath });
    }
  }, []);

  return (
    <div className="w-full h-screen overflow-hidden flex flex-row bg-slack-bg">
      <FileExplorerPanel
        markdownOnly={markdownOnly}
        onMarkdownOnlyChange={setMarkdownOnly}
        onSelectMarkdown={(workspaceId, path) => {
          setSelection({ kind: "markdown", workspaceId, path });
        }}
        onSelectTextFile={(workspaceId, path, content) => {
          setSelection({ kind: "text", workspaceId, path, content });
        }}
      />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {!selection && <EmptyViewer />}
        {selection?.kind === "markdown" && (
          <MarkdownPreview
            key={`${selection.workspaceId}:${selection.path}`}
            workspaceRoot={markdownWorkspaceRoot}
            filePath={selection.path}
            layout="embedded"
          />
        )}
        {selection?.kind === "text" && (
          <TextFileView path={selection.path} content={selection.content} />
        )}
      </div>
    </div>
  );
}
