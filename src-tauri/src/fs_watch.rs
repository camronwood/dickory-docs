use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer, DebounceEventResult};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const WORKSPACE_FS_CHANGED_EVENT: &str = "workspace-fs-changed";

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

fn path_under_skipped_dir(path: &Path) -> bool {
    for component in path.components() {
        if let Component::Normal(s) = component {
            if should_skip_dir(s.to_str().unwrap_or("")) {
                return true;
            }
        }
    }
    false
}

fn debounced_event_interesting(path: &Path) -> bool {
    !path_under_skipped_dir(path)
}

pub struct FsWatchState(Mutex<WatchInner>);

struct WatchInner {
    debouncer: Option<Debouncer<notify::RecommendedWatcher>>,
    workspace_id: Option<String>,
}

impl Default for FsWatchState {
    fn default() -> Self {
        Self(Mutex::new(WatchInner {
            debouncer: None,
            workspace_id: None,
        }))
    }
}

impl FsWatchState {
    pub fn set_watch(
        &self,
        root: &str,
        workspace_id: String,
        app: AppHandle,
    ) -> Result<(), String> {
        let root_pb = PathBuf::from(root.trim());
        if root_pb.as_os_str().is_empty() {
            return Err("workspace path is empty".into());
        }
        let root_canon = root_pb.canonicalize().map_err(|e| e.to_string())?;

        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        guard.debouncer = None;
        guard.workspace_id = Some(workspace_id.clone());

        let ws_id = workspace_id;
        let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
            let Ok(events) = res else {
                return;
            };
            if !events.iter().any(|e| debounced_event_interesting(&e.path)) {
                return;
            }
            let _ = app.emit_all(WORKSPACE_FS_CHANGED_EVENT, ws_id.clone());
        })
        .map_err(|e| e.to_string())?;

        debouncer
            .watcher()
            .watch(&root_canon, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        guard.debouncer = Some(debouncer);
        Ok(())
    }

    pub fn clear_watch(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        guard.debouncer = None;
        guard.workspace_id = None;
        Ok(())
    }
}

#[tauri::command]
pub fn workspace_fs_watch_set(
    workspace_id: String,
    state: tauri::State<FsWatchState>,
    app: AppHandle,
) -> Result<(), String> {
    let root_canon = crate::workspace_root_canonical(&workspace_id)?;
    let root = root_canon.to_string_lossy().into_owned();
    state.set_watch(&root, workspace_id, app)
}

#[tauri::command]
pub fn workspace_fs_watch_clear(state: tauri::State<FsWatchState>) -> Result<(), String> {
    state.clear_watch()
}
