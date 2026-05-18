//! Finder "Open With" and document-open URLs. Tao 0.16 (Tauri 1) does not implement these
//! NSApplicationDelegate methods, so macOS rejects opens even when Info.plist is correct.

use cocoa::base::{id, nil};
use objc::runtime::{
    class_addMethod, class_getInstanceMethod, Imp, Object, Sel, BOOL, NO, YES,
};
use objc::{msg_send, sel, sel_impl};
use std::ffi::CStr;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static PENDING_PATHS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub fn install(handle: AppHandle) {
    {
        let mut slot = APP_HANDLE.lock().expect("app handle lock");
        *slot = Some(handle.clone());
    }
    unsafe {
        register_open_handlers();
    }
    let pending = {
        let mut pending = PENDING_PATHS.lock().expect("pending paths lock");
        std::mem::take(&mut *pending)
    };
    crate::ingest_opened_paths(&handle, pending);
}

unsafe fn register_open_handlers() {
    let Some(cls) = objc::runtime::Class::get("TaoAppDelegate") else {
        return;
    };
    let cls = cls as *const objc::runtime::Class as *mut objc::runtime::Class;

    if class_getInstanceMethod(cls, sel!(application:openFiles:)).is_null() {
        let imp: Imp = std::mem::transmute(application_open_files
            as extern "C" fn(&Object, Sel, id, id));
        class_addMethod(
            cls,
            sel!(application:openFiles:),
            imp,
            b"v@:@@\0".as_ptr() as *const i8,
        );
    }
    if class_getInstanceMethod(cls, sel!(application:openURLs:)).is_null() {
        let imp: Imp = std::mem::transmute(
            application_open_urls as extern "C" fn(&Object, Sel, id, id),
        );
        class_addMethod(
            cls,
            sel!(application:openURLs:),
            imp,
            b"v@:@@\0".as_ptr() as *const i8,
        );
    }
    if class_getInstanceMethod(cls, sel!(application:openFile:)).is_null() {
        let imp: Imp = std::mem::transmute(
            application_open_file as extern "C" fn(&Object, Sel, id, id) -> BOOL,
        );
        class_addMethod(
            cls,
            sel!(application:openFile:),
            imp,
            b"c@:@s\0".as_ptr() as *const i8,
        );
    }
}

extern "C" fn application_open_files(_: &Object, _: Sel, _app: id, filenames: id) {
    queue_paths(unsafe { filenames_to_paths(filenames) });
}

extern "C" fn application_open_urls(_: &Object, _: Sel, _app: id, urls: id) {
    queue_paths(unsafe { urls_to_paths(urls) });
}

extern "C" fn application_open_file(_: &Object, _: Sel, _app: id, filename: id) -> BOOL {
    let path = unsafe { id_to_string(filename) }.map(PathBuf::from);
    let handled = path
        .filter(|p| p.is_absolute() && p.is_file())
        .map(|p| {
            queue_paths(vec![p]);
            true
        })
        .unwrap_or(false);
    if handled { YES } else { NO }
}

fn queue_paths(paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(app) = guard.as_ref() {
            crate::ingest_opened_paths(app, paths);
            return;
        }
    }
    let mut pending = PENDING_PATHS.lock().expect("pending paths lock");
    pending.extend(paths);
}

unsafe fn filenames_to_paths(filenames: id) -> Vec<PathBuf> {
    if filenames == nil {
        return vec![];
    }
    let count: usize = msg_send![filenames, count];
    let mut out = Vec::new();
    for i in 0..count {
        let entry: id = msg_send![filenames, objectAtIndex: i];
        if let Some(s) = id_to_string(entry) {
            let path = PathBuf::from(s);
            if path.is_file() {
                out.push(path);
            }
        }
    }
    out
}

unsafe fn urls_to_paths(urls: id) -> Vec<PathBuf> {
    if urls == nil {
        return vec![];
    }
    let count: usize = msg_send![urls, count];
    let mut out = Vec::new();
    for i in 0..count {
        let url: id = msg_send![urls, objectAtIndex: i];
        if url == nil {
            continue;
        }
        let is_file: BOOL = msg_send![url, isFileURL];
        if is_file == NO {
            continue;
        }
        let path: id = msg_send![url, path];
        if let Some(s) = id_to_string(path) {
            let path = PathBuf::from(s);
            if path.is_file() {
                out.push(path);
            }
        }
    }
    out
}

unsafe fn id_to_string(s: id) -> Option<String> {
    if s == nil {
        return None;
    }
    let bytes: *const i8 = msg_send![s, UTF8String];
    if bytes.is_null() {
        return None;
    }
    Some(CStr::from_ptr(bytes).to_string_lossy().into_owned())
}
