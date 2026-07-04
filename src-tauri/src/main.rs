#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "tauri")]
    {
        weavine_lib::run();
    }

    #[cfg(not(feature = "tauri"))]
    {
        eprintln!("weavine desktop binary requires the 'tauri' feature; use weavine-web for the web server");
    }
}
