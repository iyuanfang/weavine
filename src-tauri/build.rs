fn main() {
    #[cfg(feature = "tauri")]
    tauri_build::build();

    // sherpa-onnx's prebuilt Android .so is built against libc++_shared; Rust
    // defaults to libc++_static on Android, so we must pin the shared STL here
    // or the link step blows up on missing operator new/delete from onnxruntime.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "android" {
        println!("cargo:rustc-link-lib=dylib=c++_shared");
        println!("cargo:rustc-link-lib=dylib=onnxruntime");
        println!("cargo:rustc-link-lib=dylib=sherpa-onnx-c-api");
    }
}
