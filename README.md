# Dickory Docs

> Your docs, on the clock. Read Markdown where it lives.

Local-first desktop app for **Markdown preview**, **Mermaid diagrams**, and **multi-folder workspaces** — no cloud hub, no separate server.

**Site:** [camronwood.github.io/dickory-docs](https://camronwood.github.io/dickory-docs/) (enable GitHub Pages from the `/docs` folder after push)

## Quick start

**Requirements:** Node.js 18+, Rust (for Tauri), platform Tauri deps ([tauri.app](https://tauri.app/v1/guides/getting-started/prerequisites)).

```bash
git clone https://github.com/camronwood/dickory-docs.git
cd dickory-docs
npm install
make start-all
```

Vite dev server runs on port **5177**; Tauri opens the desktop window.

**Build:**

```bash
npm run build
npm run tauri:build
```

## What it does

- Add **folder workspaces** — persisted under `DickoryDocs` in your OS config dir (migrates from legacy `DocWatson` once).
- **Markdown preview** with sanitised HTML and title in the window chrome.
- **Mermaid** fenced blocks render inline; click to expand in a modal.
- **File explorer** — resizable sidebar, markdown-only filter, create/rename/delete, plain-text view for other files.
- **Preview deep link:** `?preview=true&workspace={id}&path={relativePath}`

## Stack

- **Desktop:** Tauri 1.x + React + TypeScript + Tailwind
- **Backend:** Rust (workspace JSON, directory walks, safe path I/O)
- **Markdown:** marked, DOMPurify, Mermaid 11

## Screenshots

Add images to [`assets/screenshots/`](assets/screenshots/) and link them from the [marketing site](docs/index.html) when ready.

## Docs

See [DOCS.md](DOCS.md) for the documentation index and static site paths.

## License

Open source — license TBD in repo (add `LICENSE` when publishing).
