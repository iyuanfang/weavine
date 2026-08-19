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

        copy_native_libs_to_tauri_jni_libs();
    }
}

/// Copy every `.so` file from `target/{triple}/{profile}/` into
/// `gen/android/app/src/main/jniLibs/{abi}/` so Gradle packages them into the
/// APK. sherpa-onnx-sys's build script drops its prebuilt shared libraries in
/// the profile dir via `copy_unix_runtime_libs`; without this step the APK
/// would ship with `libweavine_lib.so` only and the runtime linker would fail
/// with `UnsatisfiedLinkError` on the first voice call.
fn copy_native_libs_to_tauri_jni_libs() {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_triple = std::env::var("TARGET").unwrap_or_default();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    let abi = match target_arch.as_str() {
        "aarch64" => "arm64-v8a",
        "arm" => "armeabi-v7a",
        "x86" => "x86",
        "x86_64" => "x86_64",
        other => {
            eprintln!(
                "copy_native_libs_to_tauri_jni_libs: unknown target arch '{other}', skipping"
            );
            return;
        }
    };

    let profile_dir = manifest_dir
        .join("target")
        .join(&target_triple)
        .join(&profile);
    let jni_libs_dst = manifest_dir
        .join("gen")
        .join("android")
        .join("app")
        .join("src")
        .join("main")
        .join("jniLibs")
        .join(abi);

    if !profile_dir.is_dir() {
        eprintln!(
            "copy_native_libs_to_tauri_jni_libs: profile dir not found at {} (sherpa-onnx-sys may not have built yet; rerun)",
            profile_dir.display()
        );
        return;
    }

    let entries = match std::fs::read_dir(&profile_dir) {
        Ok(e) => e,
        Err(err) => {
            eprintln!(
                "copy_native_libs_to_tauri_jni_libs: read_dir({}) failed: {err}",
                profile_dir.display()
            );
            return;
        }
    };

    let mut copied: Vec<std::ffi::OsString> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|s| s.to_str());
        if ext != Some("so") {
            continue;
        }
        let name = match path.file_name() {
            Some(n) => n.to_os_string(),
            None => continue,
        };
        if let Err(err) = std::fs::create_dir_all(&jni_libs_dst) {
            eprintln!(
                "copy_native_libs_to_tauri_jni_libs: create_dir_all({}) failed: {err}",
                jni_libs_dst.display()
            );
            return;
        }
        let dest = jni_libs_dst.join(&name);
        match std::fs::copy(&path, &dest) {
            Ok(_) => copied.push(name),
            Err(err) => eprintln!(
                "copy_native_libs_to_tauri_jni_libs: copy({} -> {}) failed: {err}",
                path.display(),
                dest.display()
            ),
        }
    }

    if copied.is_empty() {
        eprintln!(
            "copy_native_libs_to_tauri_jni_libs: no .so files found in {}",
            profile_dir.display()
        );
    } else {
        eprintln!(
            "copy_native_libs_to_tauri_jni_libs: copied {} .so files to {} ({:?})",
            copied.len(),
            jni_libs_dst.display(),
            copied
        );
    }
}
