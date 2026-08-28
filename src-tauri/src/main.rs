#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // §11.7 desktop-only: converter sidecar. When spawned with
    // `--md-convert-sidecar <path>` we run the markitdown conversion in this
    // *separate process* and exit — so a stack overflow / panic / abort inside
    // the third-party converter (markitdown 0.1.x) can never take down the main
    // GUI process. The parent `convert_external_file` command spawns us, reads
    // the JSON on stdout, and on any failure (including our crash) shows a
    // friendly error instead of killing the app. This MUST run before
    // `weavine_lib::run()` so no window is created and the single-instance
    // plugin never initializes for the child.
    #[cfg(desktop)]
    {
        let args: Vec<String> = std::env::args().collect();
        if let Some(i) = args.iter().position(|a| a == "--md-convert-sidecar") {
            if let Some(path) = args.get(i + 1) {
                #[cfg(windows)]
                {
                    // Suppress the Windows Error Reporting crash dialog for this
                    // child so an aborted converter is silent — the parent
                    // process reports the failure to the UI.
                    unsafe {
                        windows_sys::Win32::Foundation::SetErrorMode(
                            windows_sys::Win32::Foundation::SEM_NOGPFAULTERRORBOX,
                        );
                    }
                }
                weavine_lib::convert::run_cli_convert(path);
            }
        }
    }

    #[cfg(feature = "tauri")]
    {
        weavine_lib::run();
    }

    #[cfg(not(feature = "tauri"))]
    {
        eprintln!("weavine desktop binary requires the 'tauri' feature; use weavine-web for the web server");
    }
}
