// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::api::cli::{ArgData, Matches};
use tauri::Manager;
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
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn save_workspaces_inner(list: &[WorkspaceRecord]) -> Result<(), String> {
    let p = workspaces_path()?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
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

fn rel_path_from_root(root_canon: &Path, full: &Path) -> Result<String, String> {
    let full_canon = full.canonicalize().map_err(|e| e.to_string())?;
    let rel = full_canon
        .strip_prefix(root_canon)
        .map_err(|_| "not under root".to_string())?;
    Ok(rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
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
    let pb = PathBuf::from(&path);
    if !pb.is_dir() {
        return Err("path is not a directory".into());
    }
    let mut list = load_workspaces_inner()?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let ws = WorkspaceRecord {
        id: format!("ws-{}", uuid::Uuid::new_v4()),
        name: name.trim().to_string(),
        path,
        created_at: now.clone(),
        last_used: now,
        is_git_repo: pb.join(".git").is_dir(),
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
fn dir_list(root: String, relative_path: String) -> Result<Vec<FileNodeOut>, String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
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
fn read_file_text(root: String, relative_path: String) -> Result<String, String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    if !target.is_file() {
        return Err("not a file".into());
    }
    fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_text(root: String, relative_path: String, content: String) -> Result<(), String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    fs::create_dir_all(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_entry(root: String, old_path: String, new_path: String) -> Result<(), String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let from = resolve_under_root(&root_canon, &old_path)?;
    let to = resolve_under_root(&root_canon, &new_path)?;
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

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            ext == "md" || ext == "markdown"
        })
        .unwrap_or(false)
}

/// Match TS: /```\s*mermaid\s*(\r?\n|\r)([\s\S]*?)```/gi
fn extract_mermaid_blocks_from_markdown(content: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?is)```\s*mermaid\s*(?:\r?\n|\r)([\s\S]*?)```")
            .expect("mermaid fence regex")
    });
    re.captures_iter(content)
        .filter_map(|cap| {
            let body = cap.get(1)?.as_str().trim();
            if body.is_empty() {
                None
            } else {
                Some(body.to_string())
            }
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MermaidBlockOut {
    pub path: String,
    pub block_index: u32,
    pub content: String,
}

#[tauri::command]
fn workspace_scan_mermaid(root: String) -> Result<Vec<MermaidBlockOut>, String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let mut blocks: Vec<MermaidBlockOut> = Vec::new();

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
        let rel = rel_path_from_root(&root_canon, full)?;
        let text = fs::read_to_string(full).map_err(|e| e.to_string())?;
        for (block_index, content) in extract_mermaid_blocks_from_markdown(&text)
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

    Ok(blocks)
}

const MAX_FILE_SEARCH_RESULTS: usize = 500;

fn is_markdown_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".md") || n.ends_with(".markdown")
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
    root: String,
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

    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
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
fn delete_entry(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = root_path_buf(&root)?;
    let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;
    let target = resolve_under_root(&root_canon, &relative_path)?;
    let meta = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let cli_matches = app.get_cli_matches().ok();
            let paths = collect_launch_paths(cli_matches.as_ref());
            let paths: Vec<String> = paths
                .into_iter()
                .filter_map(|p| p.canonicalize().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            handle.manage(LaunchState(Mutex::new(Some(paths))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspaces_load,
            workspace_add,
            workspace_remove,
            dir_list,
            read_file_text,
            write_file_text,
            create_folder,
            rename_entry,
            delete_entry,
            workspace_scan_mermaid,
            workspace_search_files,
            take_launch_open_files,
            resolve_external_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
