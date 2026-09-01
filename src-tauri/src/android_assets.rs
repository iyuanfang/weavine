//! Extract the bundled SenseVoice model from Android's `AssetManager` into
//! the app data dir at first launch.
//!
//! Tauri 2 stores `bundle.resources` files in the APK's `assets/` directory,
//! which Android exposes through `AssetManager` — NOT as filesystem paths.
//! `sherpa_onnx::OfflineRecognizer` reads its model via `std::fs`, so the
//! model must be copied out to a real path once. This module does that copy
//! at startup (see `lib.rs` setup) and is a no-op on non-Android targets.

#[cfg(target_os = "android")]
use std::fs;
#[cfg(target_os = "android")]
use std::path::Path;

#[cfg(target_os = "android")]
use crate::voice_local;
#[cfg(target_os = "android")]
use jni::objects::{JByteArray, JObject, JValue};
#[cfg(target_os = "android")]
use jni::sys::{jbyte, jobject};
#[cfg(target_os = "android")]
use jni::JNIEnv;

#[cfg(target_os = "android")]
pub fn extract_sense_voice_to_data_dir() -> Result<(), String> {
    let model_dir = voice_local::model_dir();
    let model_path = model_dir.join(voice_local::MODEL_FILE);
    let tokens_path = model_dir.join(voice_local::TOKENS_FILE);

    // Idempotent: don't re-copy 228 MB on every launch.
    if model_path.is_file() && tokens_path.is_file() {
        return Ok(());
    }

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("JavaVM::from_raw: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach_current_thread: {e}"))?;

    // `ctx.context()` is the Activity, which is a Context. Grab the
    // application context (long-lived) and its AssetManager.
    let activity = unsafe { JObject::from_raw(ctx.context() as jobject) };
    let app_context = env
        .call_method(
            &activity,
            "getApplicationContext",
            "()Landroid/content/Context;",
            &[],
        )
        .map_err(|e| format!("getApplicationContext: {e}"))?
        .l()
        .map_err(|e| format!("getApplicationContext result: {e}"))?;
    let asset_manager = env
        .call_method(
            &app_context,
            "getAssets",
            "()Landroid/content/res/AssetManager;",
            &[],
        )
        .map_err(|e| format!("getAssets: {e}"))?
        .l()
        .map_err(|e| format!("getAssets result: {e}"))?;

    fs::create_dir_all(&model_dir).map_err(|e| format!("create model dir: {e}"))?;

    extract_asset(&mut env, &asset_manager, "sense-voice/model.int8.onnx", &model_path)?;
    extract_asset(&mut env, &asset_manager, "sense-voice/tokens.txt", &tokens_path)?;

    Ok(())
}

#[cfg(target_os = "android")]
fn extract_asset(
    env: &mut JNIEnv,
    asset_manager: &JObject,
    asset_path: &str,
    dest: &Path,
) -> Result<(), String> {
    let path_str = env
        .new_string(asset_path)
        .map_err(|e| format!("new_string({asset_path}): {e}"))?;
    let path_obj: JObject = path_str.into();
    let stream = env
        .call_method(
            asset_manager,
            "open",
            "(Ljava/lang/String;)Ljava/io/InputStream;",
            &[JValue::from(&path_obj)],
        )
        .map_err(|e| format!("open {asset_path}: {e}"))?
        .l()
        .map_err(|e| format!("open {asset_path} result: {e}"))?;

    // InputStream.read(byte[]) -> int, -1 at EOF. Avoids readAllBytes(),
    // which requires API 26 while minSdkVersion is 24.
    let chunk_size = 64 * 1024;
    let mut all: Vec<u8> = Vec::new();
    loop {
        let buf = env
            .new_byte_array(chunk_size)
            .map_err(|e| format!("new_byte_array: {e}"))?;
        let n = env
            .call_method(&stream, "read", "([B)I", &[JValue::from(&buf)])
            .map_err(|e| format!("read {asset_path}: {e}"))?
            .i()
            .map_err(|e| format!("read {asset_path} result: {e}"))?;
        if n < 0 {
            break;
        }
        let mut chunk: Vec<jbyte> = vec![0; n as usize];
        env.get_byte_array_region(&buf, 0, &mut chunk)
            .map_err(|e| format!("get_byte_array_region: {e}"))?;
        all.extend(chunk.iter().map(|&b| b as u8));
        env.delete_local_ref(buf)
            .map_err(|e| format!("delete_local_ref: {e}"))?;
    }

    fs::write(dest, &all).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn extract_sense_voice_to_data_dir() -> Result<(), String> {
    Ok(())
}