use std::sync::Mutex;
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Store the relay process
struct RelayState {
    process: Mutex<Option<CommandChild>>,
}

#[tauri::command]
async fn start_relay(
    app: tauri::AppHandle,
    state: tauri::State<'_, RelayState>,
    http_port: u16,
    pg_port: u16,
) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;
    
    if process_guard.is_some() {
        return Err("Relay is already running".to_string());
    }

    let server_path = app.path().resolve("resources/server.cjs", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve server script: {}", e))?;
    println!("[Rust] Resolved server.cjs path: {:?}", server_path); // DEBUG LOG
    
    // Check if file exists
    if !server_path.exists() {
        println!("[Rust] CRITICAL ERROR: server.cjs does not exist at {:?}", server_path);
        return Err(format!("Server script not found at {:?}", server_path));
    } else {
        println!("[Rust] File exists. Size: {}", std::fs::metadata(&server_path).map_err(|e| e.to_string())?.len());
    }
    
    let script_path_str = server_path.to_string_lossy().to_string();

    let shell = app.shell();
    
    let (mut rx, child) = shell
        .sidecar("relay-sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args([
            script_path_str,
            "--http-port".to_string(),
            http_port.to_string(),
            "--pg-port".to_string(),
            pg_port.to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn relay: {}", e))?;

    // Spawn a task to handle output (for logging)
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[Relay] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[Relay Error] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    println!("[Relay] Process terminated with code: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    *process_guard = Some(child);
    
    Ok(format!("Relay started on ports {} (HTTP) and {} (Postgres)", http_port, pg_port))
}

#[tauri::command]
async fn stop_relay(state: tauri::State<'_, RelayState>) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;
    
    if let Some(child) = process_guard.take() {
        child.kill().map_err(|e| format!("Failed to stop relay: {}", e))?;
        Ok("Relay stopped".to_string())
    } else {
        Err("Relay is not running".to_string())
    }
}

#[tauri::command]
fn is_relay_running(state: tauri::State<'_, RelayState>) -> bool {
    state.process.lock().map(|p| p.is_some()).unwrap_or(false)
}

#[tauri::command]
fn get_connection_info(http_port: u16, pg_port: u16) -> serde_json::Value {
    serde_json::json!({
        "websocket_url": format!("ws://localhost:{}/agent", http_port),
        "postgres_url": format!("postgres://postgres@localhost:{}", pg_port),
        "health_url": format!("http://localhost:{}/health", http_port),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RelayState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_relay,
            stop_relay,
            is_relay_running,
            get_connection_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
