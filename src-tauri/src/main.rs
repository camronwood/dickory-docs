// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
