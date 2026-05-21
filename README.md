# Dickory Docs

> **A Mermaid diagram viewer that actually works** — for Markdown on your machine.

Dickory Docs was built because nothing else made it easy to **view Mermaid diagrams** in local Markdown: no paste into a web playground, no broken renders in generic previewers. Open a folder, pick a `.md` or `.mmd` file, and Mermaid diagrams become **live SVG** — inline or full-screen. Supports `` ```mermaid `` fences, untagged `` ``` `` blocks with diagram syntax, and whole-file `.mmd` sources.

Also includes Markdown preview, multi-folder workspaces, and a file explorer — all local-first (Tauri + React + Rust).

**Site:** [camronwood.github.io/dickory-docs](https://camronwood.github.io/dickory-docs/)

## Quick start

**Requirements:** Node.js 18+, Rust (for Tauri), platform Tauri deps ([tauri.app](https://tauri.app/v1/guides/getting-started/prerequisites)).

```bash
git clone https://github.com/camronwood/dickory-docs.git
cd dickory-docs
npm install
make start-all
```

Vite dev server runs on port **5177**; Tauri opens the desktop window.

**Install (download):** [GitHub Releases](https://github.com/camronwood/dickory-docs/releases) — pick the `.dmg` (macOS), `.msi` (Windows), or `.AppImage` / `.deb` (Linux) for your machine.

**Linux — which artifact?** Run `uname -m`:

| `uname -m` | Download |
|------------|----------|
| `x86_64` | `*_amd64.AppImage` or `*_amd64.deb` |
| `aarch64` | `*_aarch64.AppImage` or `*_aarch64.deb` |

One-time setup: `chmod +x` the AppImage; on Ubuntu, `sudo apt install libfuse2t64` or `libfuse2` if the AppImage won’t start. Ubuntu 24.04: AppImage is more reliable than `.deb` (WebKit 4.0 dependency). Optional installer script: [`scripts/install-linux.sh`](scripts/install-linux.sh).

**macOS — which `.dmg`?** Run `uname -m` in Terminal:

| `uname -m` | Download |
|------------|----------|
| `arm64` | `*_aarch64.dmg` (native Apple Silicon) |
| `x86_64` | `*_x64.dmg` (Intel Mac) |

If you are on Apple Silicon (`arm64`) and the native build misbehaves, try `*_x64.dmg` instead — it runs under Rosetta.

macOS builds are unsigned; use **Right-click → Open** the first time if Gatekeeper warns.

**Build installers locally:**

```bash
npm install
npm run tauri:build
# Output: src-tauri/target/release/bundle/  (.dmg on macOS, .msi on Windows, etc.)
```

Or: `make build-release` on macOS after [Tauri prerequisites](https://v1.tauri.app/v1/guides/getting-started/prerequisites/) are installed.

## Why Mermaid first

- **Inline SVG** — `mermaid`-tagged fences, untagged diagram fences, and `.mmd` files render in the preview pane, not as raw code.
- **Expand to modal** — dense flowcharts and sequence diagrams get a full-screen view.
- **Retry on errors** — bad syntax surfaces clearly instead of failing silently.
- **Local files** — diagrams never leave your machine; point at any folder on disk.

## Also included

- **Folder workspaces** — persisted under `DickoryDocs` in your OS config dir (migrates from legacy `DocWatson` once). MRU tabs for recent roots; **···** or **⌘⇧W** / **Ctrl+Shift+W** to search and switch when you have many folders.
- **Markdown preview** — sanitised HTML, title in the window chrome.
- **File explorer** — resizable sidebar, Markdown & `.mmd` filter (workspace scan, no empty folders), live refresh when files change on disk, create/rename/delete.
- **Preview deep link:** `?preview=true&workspace={id}&path={relativePath}`

## Stack

- **Desktop:** Tauri 1.x + React + TypeScript + Tailwind
- **Diagrams:** Mermaid 11 + ELK + tidy-tree layouts
- **Markdown:** marked, DOMPurify
- **Backend:** Rust (workspace JSON, directory walks, safe path I/O)

## Screenshots

See [`assets/screenshots/`](assets/screenshots/) — split editor, preview-only mode, and diagram gallery captures. The [marketing site](https://camronwood.github.io/dickory-docs/) uses the same images.

## Docs

See [DOCS.md](DOCS.md) for the documentation index and static site paths.

## License

Open source — license TBD in repo (add `LICENSE` when publishing).
