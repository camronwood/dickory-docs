// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos_open;

mod fs_watch;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::api::cli::{ArgData, Matches};
use tauri::{AppHandle, Manager};

pub const EXTERNAL_OPEN_FILES_EVENT: &str = "external-open-files";
use walkdir::WalkDir;

struct LaunchState(Mutex<Option<Vec<String>>>);
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_used: String,
    #[serde(default)]
    pub is_git_repo: bool,
    #[serde(default)]
    pub git_remote: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct FileNodeOut {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mod_time: String,
    pub path: String,
}

fn migrate_legacy_config(base: &Path) {
    let new_dir = base.join("DickoryDocs");
    let legacy_dir = base.join("DocWatson");
    let new_file = new_dir.join("workspaces.json");
    let legacy_file = legacy_dir.join("workspaces.json");
    if new_file.exists() || !legacy_file.exists() {
        return;
    }
    if fs::create_dir_all(&new_dir).is_err() {
        return;
    }
    let _ = fs::copy(&legacy_file, &new_file);
}

fn workspaces_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "config directory unavailable".to_string())?;
    migrate_legacy_config(&base);
    let dir = base.join("DickoryDocs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspaces.json"))
}

fn load_workspaces_inner() -> Result<Vec<WorkspaceRecord>, String> {
    let p = workspaces_path()?;
    if !p.exists() {
        return Ok(vec![]);
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let mut list: Vec<WorkspaceRecord> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let mut changed = false;
    for ws in list.iter_mut() {
        if let Ok(canon) = canonical_workspace_dir(&ws.path) {
            let resolved = canon.to_string_lossy().into_owned();
            if resolved != ws.path {
                ws.path = resolved;
                changed = true;
            }
        }
    }
    if changed {
        save_workspaces_inner(&list)?;
    }
    Ok(list)
}

/// Resolve workspace root to an absolute path (fixes `~/…`, relative paths, symlinks on Linux).
fn canonical_workspace_dir(path: &str) -> Result<PathBuf, String> {
    let pb = PathBuf::from(path.trim());
    if !pb.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    pb.canonicalize()
        .map_err(|e| format!("could not resolve workspace path: {e}"))
}

fn save_workspaces_inner(list: &[WorkspaceRecord]) -> Result<(), String> {
    let p = workspaces_path()?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Canonical root for a workspace registered in `workspaces.json`.
/// File IPC commands must take `workspace_id` only — never a client-supplied root path.
pub fn workspace_root_canonical(workspace_id: &str) -> Result<PathBuf, String> {
    let list = load_workspaces_inner()?;
    let ws = list
        .iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    canonical_workspace_dir(&ws.path)
}

/// Reject `..` and absolute components; return normalized relative path using `/`.
fn normalize_rel(rel: &str) -> Result<String, String> {
    let rel = rel.trim().replace('\\', "/");
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() {
        return Ok(String::new());
    }
    for seg in rel.split('/') {
        if seg == ".." {
            return Err("invalid path".into());
        }
        if seg.contains(':') {
            return Err("invalid path".into());
        }
    }
    Ok(rel.to_string())
}

fn root_path_buf(root: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(root.trim());
    if p.as_os_str().is_empty() {
        return Err("empty root".into());
    }
    Ok(p)
}

/// Resolve `rel` under `root` (must already be canonical). Works for not-yet-existing files.
/// Max bytes read into memory for a single file (DoS guard).
const MAX_READ_FILE_BYTES: u64 = 32 * 1024 * 1024;

fn resolve_under_root(root_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = normalize_rel(rel)?;
    let mut cur = root_canon.to_path_buf();
    if rel.is_empty() {
        return Ok(cur);
    }
    for seg in rel.split('/').filter(|s| !s.is_empty()) {
        cur.push(seg);
        if cur.exists() {
            cur = cur.canonicalize().map_err(|e| e.to_string())?;
        }
        if !cur.starts_with(root_canon) {
            return Err("path escapes workspace root".into());
        }
    }
    Ok(cur)
}

/// Canonicalize a resolved path and ensure it remains under `root_canon` (blocks symlink escape).
fn ensure_under_root(root_canon: &Path, resolved: &Path) -> Result<PathBuf, String> {
    let target = if resolved.exists() {
        resolved.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = resolved
            .parent()
            .ok_or_else(|| "invalid path".to_string())?;
        let file_name = resolved
            .file_name()
            .ok_or_else(|| "invalid path".to_string())?;
        let parent_canon = if parent.as_os_str().is_empty() {
            root_canon.to_path_buf()
        } else if parent.exists() {
            parent.canonicalize().map_err(|e| e.to_string())?
        } else {
            ensure_under_root(root_canon, parent)?
        };
        if !parent_canon.starts_with(root_canon) {
            return Err("path escapes workspace root".into());
        }
        parent_canon.join(file_name)
    };
    if !target.starts_with(root_canon) {
        return Err("path escapes workspace root".into());
    }
    Ok(target)
}

fn rel_path_from_root(root_canon: &Path, full: &Path) -> Result<String, String> {
    rel_path_from_root_opt(root_canon, full).ok_or_else(|| "not under root".to_string())
}

fn rel_path_from_root_opt(root_canon: &Path, full: &Path) -> Option<String> {
    let full_canon = full.canonicalize().ok()?;
    if !full_canon.starts_with(root_canon) {
        return None;
    }
    let rel = full_canon.strip_prefix(root_canon).ok()?;
    Some(
        rel.components()
            .filter_map(|c| match c {
                Component::Normal(s) => s.to_str(),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn walkdir_entry_under_root(root_canon: &Path, entry: &walkdir::DirEntry) -> bool {
    entry
        .path()
        .canonicalize()
        .map(|p| p.starts_with(root_canon))
        .unwrap_or(false)
}

fn iso_mtime(meta: &fs::Metadata) -> String {
    meta
        .modified()
        .ok()
        .and_then(|t| {
            let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
            DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos() as u32)
                .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        })
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".into())
}

#[tauri::command]
fn workspaces_load() -> Result<Vec<WorkspaceRecord>, String> {
    load_workspaces_inner()
}

#[tauri::command]
fn workspace_add(name: String, path: String) -> Result<WorkspaceRecord, String> {
    let path = path.trim().to_string();
    if name.trim().is_empty() || path.is_empty() {
        return Err("name and path required".into());
    }
    let canon = canonical_workspace_dir(&path)?;
    let path = canon.to_string_lossy().into_owned();
    let mut list = load_workspaces_inner()?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let ws = WorkspaceRecord {
        id: format!("ws-{}", uuid::Uuid::new_v4()),
        name: name.trim().to_string(),
        path: path.clone(),
        created_at: now.clone(),
        last_used: now,
        is_git_repo: canon.join(".git").is_dir(),
        git_remote: None,
        git_branch: None,
    };
    list.push(ws.clone());
    save_workspaces_inner(&list)?;
    Ok(ws)
}

#[tauri::command]
fn workspace_remove(id: String) -> Result<(), String> {
    let mut list = load_workspaces_inner()?;
    let n = list.len();
    list.retain(|w| w.id != id);
    if list.len() == n {
        return Err("workspace not found".into());
    }
    save_workspaces_inner(&list)
}

#[tauri::command]
fn workspace_touch(id: String) -> Result<WorkspaceRecord, String> {
    let mut list = load_workspaces_inner()?;
    let ws = list
        .iter_mut()
        .find(|w| w.id == id)
        .ok_or_else(|| "workspace not found".to_string())?;
    ws.last_used = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let updated = ws.clone();
    save_workspaces_inner(&list)?;
    Ok(updated)
}

#[tauri::command]
fn dir_list(workspace_id: String, relative_path: String) -> Result<Vec<FileNodeOut>, String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let rel = normalize_rel(&relative_path)?;
    let dir = resolve_under_root(&root_canon, &rel)?;
    if !dir.is_dir() {
        return Err("not a directory".into());
    }
    let mut out: Vec<FileNodeOut> = Vec::new();
    for ent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let meta = ent.metadata().map_err(|e| e.to_string())?;
        let name = ent.file_name().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let full = ent.path();
        let path_rel = rel_path_from_root(&root_canon, &full)?;
        out.push(FileNodeOut {
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            mod_time: iso_mtime(&meta),
            path: path_rel,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
fn read_file_text(workspace_id: String, relative_path: String) -> Result<String, String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    let target = ensure_under_root(&root_canon, &target)?;
    if !target.is_file() {
        return Err("not a file".into());
    }
    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_FILE_BYTES {
        return Err(format!(
            "file too large (max {} MiB)",
            MAX_READ_FILE_BYTES / (1024 * 1024)
        ));
    }
    fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_text(
    workspace_id: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    let target = ensure_under_root(&root_canon, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder(workspace_id: String, relative_path: String) -> Result<(), String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    let target = ensure_under_root(&root_canon, &target)?;
    fs::create_dir_all(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_entry(
    workspace_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let from = resolve_under_root(&root_canon, &old_path)?;
    let from = ensure_under_root(&root_canon, &from)?;
    let to = resolve_under_root(&root_canon, &new_path)?;
    let to = ensure_under_root(&root_canon, &to)?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    ".tauri",
];

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIR_NAMES.contains(&name)
}

fn markdown_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "mdx" | "mmd"
    )
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(markdown_extension)
        .unwrap_or(false)
}

fn is_mmd_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("mmd"))
}

fn first_info_token(info_line: &str) -> String {
    let trimmed = info_line.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_code_fence_lang(token: &str) -> bool {
    matches!(
        token,
        "python"
            | "py"
            | "rust"
            | "rs"
            | "go"
            | "golang"
            | "javascript"
            | "js"
            | "typescript"
            | "ts"
            | "tsx"
            | "jsx"
            | "bash"
            | "sh"
            | "shell"
            | "zsh"
            | "fish"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "sass"
            | "sql"
            | "java"
            | "kotlin"
            | "kt"
            | "swift"
            | "ruby"
            | "rb"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "csharp"
            | "cs"
            | "php"
            | "lua"
            | "r"
            | "dart"
            | "scala"
            | "perl"
            | "pl"
            | "dockerfile"
            | "makefile"
            | "cmake"
            | "diff"
            | "patch"
            | "text"
            | "txt"
            | "plaintext"
            | "console"
            | "terminal"
            | "powershell"
            | "ps1"
            | "objc"
            | "objectivec"
            | "matlab"
            | "latex"
            | "tex"
            | "bibtex"
            | "graphql"
            | "protobuf"
            | "proto"
            | "wasm"
            | "llvm"
            | "ini"
            | "properties"
            | "csv"
            | "markdown"
            | "md"
    )
}

fn looks_like_mermaid_diagram(body: &str) -> bool {
    static DIAGRAM_START: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static INIT_LINE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let diagram_start = DIAGRAM_START.get_or_init(|| {
        Regex::new(
            r"(?i)^(graph\b|flowchart\b|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|journey\b|gantt\b|pie\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|C4Context\b|block-beta\b|xychart\b|sankey\b)",
        )
        .expect("diagram start regex")
    });
    let init_line = INIT_LINE.get_or_init(|| {
        Regex::new(r"(?s)^\s*%%\{[\s\S]*?\}%%\s*$").expect("init directive regex")
    });

    for line in body.trim().lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if init_line.is_match(line) {
            continue;
        }
        return diagram_start.is_match(line);
    }
    false
}

fn fence_accepts_as_mermaid(info_line: &str, body: &str) -> bool {
    let token = first_info_token(info_line);
    if token == "mermaid" {
        return true;
    }
    if !token.is_empty() && is_code_fence_lang(&token) {
        return false;
    }
    if token.is_empty() {
        return looks_like_mermaid_diagram(body);
    }
    false
}

fn mermaid_body_from_fence(info_line: &str, body: &str) -> String {
    let trimmed_body = body.trim();
    let info = info_line.trim();
    if first_info_token(info_line) != "mermaid" {
        return trimmed_body.to_string();
    }
    let rest = if info.len() >= 7 && info[..7].eq_ignore_ascii_case("mermaid") {
        info[7..].trim_start()
    } else {
        ""
    };
    if rest.is_empty() {
        return trimmed_body.to_string();
    }
    if trimmed_body.is_empty() {
        return rest.to_string();
    }
    format!("{rest}\n{trimmed_body}")
}

/// Match TS `extractMermaidBlocksFromText` in mermaidDetect.ts.
pub fn extract_mermaid_blocks(content: &str, path: Option<&Path>) -> Vec<String> {
    if path.is_some_and(is_mmd_path) {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return vec![];
        }
        return vec![trimmed.to_string()];
    }

    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?is)```([^\n`]*)(?:\r?\n|\r)([\s\S]*?)```\s*").expect("fence regex")
    });

    re.captures_iter(content)
        .filter_map(|cap| {
            let info = cap.get(1)?.as_str();
            let body = cap.get(2)?.as_str();
            if !fence_accepts_as_mermaid(info, body) {
                return None;
            }
            let combined = mermaid_body_from_fence(info, body);
            let trimmed = combined.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

/// Markdown / MDX content without a path (`.mmd` whole-file rules do not apply).
pub fn extract_mermaid_blocks_from_markdown(content: &str) -> Vec<String> {
    extract_mermaid_blocks(content, None)
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MermaidBlockOut {
    pub path: String,
    pub block_index: u32,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MermaidScanOut {
    pub blocks: Vec<MermaidBlockOut>,
    pub markdown_files: u32,
    pub files_unreadable: u32,
}

#[tauri::command]
fn workspace_scan_mermaid(workspace_id: String) -> Result<MermaidScanOut, String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let mut blocks: Vec<MermaidBlockOut> = Vec::new();
    let mut markdown_files: u32 = 0;
    let mut files_unreadable: u32 = 0;

    for entry in WalkDir::new(&root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                if should_skip_dir(&name) {
                    return false;
                }
            }
            walkdir_entry_under_root(&root_canon, e)
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                files_unreadable += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let full = entry.path();
        if !is_markdown_file(full) {
            continue;
        }
        let Some(rel) = rel_path_from_root_opt(&root_canon, full) else {
            files_unreadable += 1;
            continue;
        };
        let text = match fs::metadata(full).and_then(|meta| {
            if meta.len() > MAX_READ_FILE_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "file too large",
                ));
            }
            fs::read_to_string(full)
        }) {
            Ok(t) => t,
            Err(_) => {
                files_unreadable += 1;
                continue;
            }
        };
        markdown_files += 1;
        for (block_index, content) in extract_mermaid_blocks(&text, Some(full))
            .into_iter()
            .enumerate()
        {
            blocks.push(MermaidBlockOut {
                path: rel.clone(),
                block_index: block_index as u32,
                content,
            });
        }
    }

    blocks.sort_by(|a, b| {
        a.path
            .to_lowercase()
            .cmp(&b.path.to_lowercase())
            .then(a.block_index.cmp(&b.block_index))
    });

    Ok(MermaidScanOut {
        blocks,
        markdown_files,
        files_unreadable,
    })
}

const MAX_FILE_SEARCH_RESULTS: usize = 500;

fn is_markdown_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".md")
        || n.ends_with(".markdown")
        || n.ends_with(".mdx")
        || n.ends_with(".mmd")
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct FileSearchResult {
    pub results: Vec<FileNodeOut>,
    pub truncated: bool,
}

/// Walk the full workspace and return entries whose file or folder name contains `query`.
#[tauri::command]
fn workspace_search_files(
    workspace_id: String,
    query: String,
    markdown_only: bool,
) -> Result<FileSearchResult, String> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return Ok(FileSearchResult {
            results: vec![],
            truncated: false,
        });
    }

    let root_canon = workspace_root_canonical(&workspace_id)?;
    let mut out: Vec<FileNodeOut> = Vec::new();

    for entry in WalkDir::new(&root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
    {
        if out.len() >= MAX_FILE_SEARCH_RESULTS {
            break;
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_ascii_lowercase().contains(&q) {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        if markdown_only && !is_markdown_name(&name) {
            continue;
        }
        let full = entry.path();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let path_rel = rel_path_from_root(&root_canon, full)?;
        out.push(FileNodeOut {
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            mod_time: iso_mtime(&meta),
            path: path_rel,
        });
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    let truncated = out.len() >= MAX_FILE_SEARCH_RESULTS;
    Ok(FileSearchResult { results: out, truncated })
}

/// All `.md`, `.markdown`, `.mdx`, and `.mmd` files under a workspace (for markdown-only tree).
#[tauri::command]
fn workspace_list_markdown_files(workspace_id: String) -> Result<Vec<FileNodeOut>, String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let mut out: Vec<FileNodeOut> = Vec::new();

    for entry in WalkDir::new(&root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let full = entry.path();
        if !is_markdown_file(full) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let path_rel = rel_path_from_root(&root_canon, full)?;
        let name = entry.file_name().to_string_lossy().to_string();
        out.push(FileNodeOut {
            name,
            is_dir: false,
            size: meta.len(),
            mod_time: iso_mtime(&meta),
            path: path_rel,
        });
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn push_markdown_path(paths: &mut Vec<PathBuf>, raw: &str) {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('-') {
        return;
    }
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return;
    }
    if p.is_file() && is_markdown_file(&p) {
        paths.push(p);
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let key = p.canonicalize().unwrap_or(p.clone());
        if seen.insert(key) {
            out.push(p);
        }
    }
    out
}

fn dedupe_path_strings(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let key = PathBuf::from(&p)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(&p));
        if seen.insert(key) {
            out.push(p);
        }
    }
    out
}

fn paths_to_open_strings(paths: Vec<PathBuf>) -> Vec<String> {
    dedupe_paths(paths)
        .into_iter()
        .filter(|p| is_markdown_file(p))
        .filter_map(|p| p.canonicalize().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn merge_launch_open_files(state: &LaunchState, new_paths: Vec<String>) {
    let mut guard = state.0.lock().expect("launch state lock");
    let mut merged = guard.take().unwrap_or_default();
    merged.extend(new_paths);
    *guard = Some(dedupe_path_strings(merged));
}

/// Finder Open With, `open -a`, and other macOS document-delivery paths.
pub(crate) fn ingest_opened_paths(app: &AppHandle, raw: Vec<PathBuf>) {
    let paths = paths_to_open_strings(raw);
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<LaunchState>() {
        merge_launch_open_files(&state, paths.clone());
    }
    let _ = app.emit_all(EXTERNAL_OPEN_FILES_EVENT, paths);
}

fn collect_launch_paths(cli_matches: Option<&Matches>) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(matches) = cli_matches {
        if let Some(ArgData { value, .. }) = matches.args.get("file") {
            match value {
                Value::String(s) => push_markdown_path(&mut paths, s.as_str()),
                Value::Array(items) => {
                    for item in items {
                        if let Value::String(s) = item {
                            push_markdown_path(&mut paths, s.as_str());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    for arg in std::env::args().skip(1) {
        push_markdown_path(&mut paths, &arg);
    }

    dedupe_paths(paths)
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct OpenFileResolution {
    pub workspace_path: String,
    pub relative_path: String,
    pub add_workspace: bool,
    pub workspace_name: String,
}

#[tauri::command]
fn take_launch_open_files(state: tauri::State<LaunchState>) -> Result<Vec<String>, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let paths = guard.take().unwrap_or_default();
    Ok(paths)
}

#[tauri::command]
fn resolve_external_file(path: String) -> Result<OpenFileResolution, String> {
    let file = PathBuf::from(path.trim());
    let file = file.canonicalize().map_err(|e| e.to_string())?;
    if !file.is_file() {
        return Err("not a file".into());
    }
    if !is_markdown_file(&file) {
        return Err("not a markdown file".into());
    }

    let workspaces = load_workspaces_inner()?;
    let mut best: Option<&WorkspaceRecord> = None;
    let mut best_len = 0usize;

    for ws in &workspaces {
        let root = PathBuf::from(&ws.path);
        let Ok(root_canon) = root.canonicalize() else {
            continue;
        };
        if file.starts_with(&root_canon) {
            let len = root_canon.as_os_str().len();
            if len > best_len {
                best_len = len;
                best = Some(ws);
            }
        }
    }

    if let Some(ws) = best {
        let root_canon = PathBuf::from(&ws.path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let rel = rel_path_from_root(&root_canon, &file)?;
        return Ok(OpenFileResolution {
            workspace_path: ws.path.clone(),
            relative_path: rel,
            add_workspace: false,
            workspace_name: ws.name.clone(),
        });
    }

    let parent = file.parent().ok_or_else(|| "file has no parent directory".to_string())?;
    let parent_canon = parent.canonicalize().map_err(|e| e.to_string())?;
    let relative_path = file
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid file name".to_string())?
        .to_string();
    let workspace_name = parent
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Documents")
        .to_string();

    Ok(OpenFileResolution {
        workspace_path: parent_canon.to_string_lossy().into_owned(),
        relative_path,
        add_workspace: true,
        workspace_name,
    })
}

#[tauri::command]
fn delete_entry(workspace_id: String, relative_path: String) -> Result<(), String> {
    let root_canon = workspace_root_canonical(&workspace_id)?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    let target = ensure_under_root(&root_canon, &target)?;
    let meta = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("cannot delete symlinks".into());
    }
    if meta.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_under_root, extract_mermaid_blocks, extract_mermaid_blocks_from_markdown,
        normalize_rel, resolve_under_root, workspace_root_canonical,
    };
    use std::fs;
    use std::path::Path;

    #[test]
    fn workspace_root_canonical_rejects_unknown_id() {
        assert!(workspace_root_canonical("ws-nonexistent-id").is_err());
    }

    #[test]
    fn normalize_rel_rejects_parent_segments() {
        assert!(normalize_rel("../secret").is_err());
        assert!(normalize_rel("docs/../../etc/passwd").is_err());
        assert_eq!(normalize_rel("docs/a.md").unwrap(), "docs/a.md");
    }

    #[test]
    fn resolve_under_root_stays_inside() {
        let tmp = std::env::temp_dir().join(format!("dickory-path-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        let root_canon = tmp.canonicalize().unwrap();
        let inside = resolve_under_root(&root_canon, "sub/file.md").unwrap();
        assert!(inside.starts_with(&root_canon));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_under_root_rejects_symlink_outside() {
        let tmp = std::env::temp_dir().join(format!("dickory-sym-test-{}", uuid::Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("dickory-out-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let secret = outside.join("secret.txt");
        fs::write(&secret, "nope").unwrap();
        let link = tmp.join("link.md");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let root_canon = tmp.canonicalize().unwrap();
        // Symlink must not resolve to a path outside the workspace (walk + canonicalize).
        assert!(resolve_under_root(&root_canon, "link.md").is_err());
        let _ = fs::remove_file(&link);
        let _ = fs::remove_file(&secret);
        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn mermaid_fence_with_newline() {
        let md = "# T\n\n```mermaid\ngraph TD\n  A --> B\n```\n";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].contains("graph TD"));
    }

    #[test]
    fn mermaid_fence_same_line_after_tag() {
        let md = "```mermaid\ngraph LR\n  X --> Y\n```";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
    }

    #[test]
    fn mermaid_fence_inline_body() {
        let md = "```mermaid graph TD\n  A --> B\n```";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].starts_with("graph TD"));
    }

    #[test]
    fn mermaid_fence_closing_whitespace() {
        let md = "```mermaid\nflowchart TD\n  A --> B\n```   \n";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
    }

    #[test]
    fn mermaid_fence_case_insensitive() {
        let md = "```MERMAID\nsequenceDiagram\n  A->>B: hi\n```";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
    }

    #[test]
    fn mermaid_layout_samples_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../samples/mermaid-layouts.md");
        let md = std::fs::read_to_string(&path).expect("samples/mermaid-layouts.md");
        let blocks = extract_mermaid_blocks_from_markdown(&md);
        assert_eq!(blocks.len(), 5, "layout sample fixture should have 5 blocks");
        assert!(blocks[0].contains("flowchart LR"));
        assert!(blocks[1].contains("defaultRenderer"));
        assert!(blocks[2].contains("elk.stress"));
        assert!(blocks[3].contains("flowchart-elk"));
        assert!(blocks[4].contains("tidy-tree"));
    }

    #[test]
    fn untagged_fence_with_init() {
        let md = "```\n%%{init: {'theme': 'dark'}}%%\ngraph LR\n  A --> B\n```\n";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].contains("graph LR"));
    }

    #[test]
    fn skips_python_fence() {
        let md = "```python\ngraph TD\n  A --> B\n```\n";
        let blocks = extract_mermaid_blocks_from_markdown(md);
        assert_eq!(blocks.len(), 0);
    }

    #[test]
    fn mmd_whole_file() {
        let content = "%%{init: {'theme': 'dark'}}%%\ngraph LR\n  A --> B\n";
        let path = Path::new("diagrams/flow.mmd");
        let blocks = extract_mermaid_blocks(content, Some(path));
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].contains("graph LR"));
    }
}

fn main() {
    tauri::Builder::default()
        .manage(fs_watch::FsWatchState::default())
        .setup(|app| {
            let handle = app.handle();
            let cli_matches = app.get_cli_matches().ok();
            let paths = paths_to_open_strings(collect_launch_paths(cli_matches.as_ref()));
            handle.manage(LaunchState(Mutex::new(Some(paths))));
            #[cfg(target_os = "macos")]
            macos_open::install(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspaces_load,
            workspace_add,
            workspace_remove,
            workspace_touch,
            dir_list,
            read_file_text,
            write_file_text,
            create_folder,
            rename_entry,
            delete_entry,
            workspace_scan_mermaid,
            workspace_search_files,
            workspace_list_markdown_files,
            fs_watch::workspace_fs_watch_set,
            fs_watch::workspace_fs_watch_clear,
            take_launch_open_files,
            resolve_external_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
