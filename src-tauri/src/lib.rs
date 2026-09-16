// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use std::process::Command;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Result of running a Python script as a subprocess. Serialized to the
/// frontend so it can show real stdout/stderr rather than just a
/// success/failure boolean — GLIP's CLI scripts already print useful
/// progress and summary info (see scripts/run_ml_training.py and
/// scripts/run_recommendations.py in the GLIP project).
#[derive(Serialize)]
struct PyRunResult {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

/// Runs `<python_path> <script_relative_path> <args...>` with its working
/// directory set to `cwd` (the GLIP project root), so GLIP's scripts —
/// which resolve their own defaults like `data/processed/glip.db`
/// relative to cwd — behave exactly as they do when run by hand from a
/// terminal in that folder.
///
/// Deliberately implemented with plain `std::process::Command` rather
/// than tauri-plugin-shell: this is an app-defined command running in
/// the already-trusted Rust backend, so it needs no capability/ACL
/// entry, unlike plugin-provided commands.
#[tauri::command]
async fn run_python_script(
    python_path: String,
    cwd: String,
    script_relative_path: String,
    args: Vec<String>,
) -> Result<PyRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&python_path)
            .current_dir(&cwd)
            .arg(&script_relative_path)
            .args(&args)
            .output()
            .map_err(|e| {
                format!(
                    "Failed to launch '{}' in '{}': {}. Check the Python executable path and GLIP project path in Settings.",
                    python_path, cwd, e
                )
            })?;

        Ok(PyRunResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
        })
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

/// Reads an arbitrary file's raw bytes back into the frontend — used to
/// pull the freshly-retrained glip.db back into JS after a Python
/// subprocess run, so it can be fed straight into the existing
/// parseGlipDatabase/applyGlipData import pipeline without duplicating
/// that logic on the Rust side.
#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

/// Resolves (and creates if needed) a `cover-art/` subfolder under the
/// app's own data directory — the on-disk cache location for downloaded
/// cover art (README item: previously always loaded live from IGDB's
/// CDN). Returns the directory path as a string; the frontend builds
/// per-game file paths under it itself.
#[tauri::command]
async fn get_app_cache_dir(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
        let cover_art_dir = dir.join("cover-art");
        std::fs::create_dir_all(&cover_art_dir)
            .map_err(|e| format!("Failed to create cover-art cache directory: {}", e))?;
        Ok(cover_art_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

#[tauri::command]
async fn file_exists(path: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || std::path::Path::new(&path).is_file())
        .await
        .unwrap_or(false)
}

#[tauri::command]
async fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for '{}': {}", path, e))?;
        }
        std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write '{}': {}", path, e))
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

/// Reads a file as UTF-8 text — for parsing Steam's .vdf manifests and
/// Epic's .item JSON manifests, both plain text formats where returning
/// a String is more convenient on the JS side than the raw-bytes shape
/// read_binary_file returns (used instead for genuinely binary data like
/// cover art and glip.db).
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

/// Recursively lists every file under `root` whose extension (matched
/// case-insensitively, without the leading dot) is in `extensions` —
/// used for both ROM folder scanning and, more narrowly, could serve
/// Steam/Epic manifest listing too, though those use direct known
/// filenames instead since their locations are fixed.
///
/// `max_depth` bounds the recursion (ROM collections are sometimes
/// organized several folders deep by console/region) without risking a
/// runaway scan into something huge or symlink-cyclical. A depth of 0
/// means only `root` itself; each subfolder adds 1.
#[tauri::command]
async fn list_files_recursive(
    root: String,
    extensions: Vec<String>,
    max_depth: u32,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let extensions_lower: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();
        let mut results = Vec::new();
        walk_dir(
            std::path::Path::new(&root),
            &extensions_lower,
            max_depth,
            &mut results,
        )
        .map_err(|e| format!("Failed to scan '{}': {}", root, e))?;
        Ok(results)
    })
    .await
    .map_err(|e| format!("Internal task error: {}", e))?
}

fn walk_dir(
    dir: &std::path::Path,
    extensions_lower: &[String],
    depth_remaining: u32,
    results: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if depth_remaining > 0 {
                // A single unreadable subfolder (permissions, a broken
                // symlink) shouldn't abort the whole scan — skip it and
                // keep going, same reasoning as the extension filter
                // below just silently not matching files it can't read.
                let _ = walk_dir(&path, extensions_lower, depth_remaining - 1, results);
            }
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if extensions_lower.contains(&ext.to_lowercase()) {
                results.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

/// Windows-only: looks up Steam's install path from the registry
/// (HKEY_CURRENT_USER\Software\Valve\Steam, value SteamPath) via the
/// built-in `reg.exe` — deliberately not the `winreg` crate: this is a
/// single read-only lookup, and shelling out to a decades-stable native
/// Windows tool with plain std::process::Command avoids adding a new
/// Cargo dependency for something this narrow, consistent with this
/// project's existing preference (see run_python_script) for plain std
/// over an extra crate/plugin wherever std alone can do the job.
/// Returns None (not an error) on any failure — not finding it this way
/// isn't fatal, since the frontend falls back to a default path guess
/// and a manual override field either way.
#[tauri::command]
async fn find_steam_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let output = Command::new("reg")
                .args([
                    "query",
                    r"HKEY_CURRENT_USER\Software\Valve\Steam",
                    "/v",
                    "SteamPath",
                ])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if let Some(idx) = line.find("REG_SZ") {
                    let path = line[idx + "REG_SZ".len()..].trim();
                    if !path.is_empty() {
                        // Steam stores this with forward slashes even on
                        // Windows — normalize to the platform separator
                        // so it joins cleanly with subsequent path parts.
                        return Some(path.replace('/', "\\"));
                    }
                }
            }
            None
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    })
    .await
    .unwrap_or(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_python_script,
            read_binary_file,
            get_app_cache_dir,
            file_exists,
            write_binary_file,
            read_text_file,
            list_files_recursive,
            find_steam_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
