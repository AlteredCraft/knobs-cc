mod catalog;
mod cli_layer;
mod env_layer;
mod env_vars;
mod managed_layer;
mod runtime;
mod settings;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            match watcher::SettingsWatcher::start(handle) {
                Ok(w) => {
                    app.manage(w);
                }
                Err(e) => eprintln!("settings watcher failed to start: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::read_settings_layers,
            catalog::read_catalog,
            env_vars::read_shell_env_vars,
            runtime::read_runtime_layer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
