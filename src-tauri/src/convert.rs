//! src-tauri/src/convert.rs — convert non-`.md` files (docx, pdf, html, …)
//! to markdown so the existing md editor pipeline can edit them.
//!
//! Desktop only — excluded on Android via the module-level cfg below, since
//! the markitdown dep can't cross-compile for aarch64-linux-android (see
//! src-tauri/Cargo.toml for the full reason).
#![cfg(not(target_os = "android"))]

//!
//! The editor always sees a markdown string; the original binary / rich-text
//! file is preserved untouched. On save, the editor writes a sibling
//! `<name>.md` next to the original. Re-opening the original recomputes a
//! SHA1 + mtime; if the source changed since last conversion, the UI
//! prompts before overwriting any user edits to the sibling.
//!
//! Strategy:
//!   - `.md`            → passthrough read
//!   - `.txt`           → passthrough read (utf-8 / lossy)
//!   - everything else  → try markitdown, fall back to plain-text read on
//!                         any error so unsupported formats still surface
//!                         as an editable buffer rather than a hard failure.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use markitdown::MarkItDown;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SourceFormat {
    Md,
    Txt,
    Docx,
    Pdf,
    Html,
    Xlsx,
    Pptx,
    Other,
}

impl SourceFormat {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_ascii_lowercase().as_str() {
            "md" | "markdown" => Self::Md,
            "txt" => Self::Txt,
            "docx" => Self::Docx,
            "pdf" => Self::Pdf,
            "html" | "htm" => Self::Html,
            "xlsx" => Self::Xlsx,
            "pptx" => Self::Pptx,
            _ => Self::Other,
        }
    }

    /// True for container / binary formats that have no meaningful plain-text
    /// rendering. Running `from_utf8_lossy` over a .docx (a ZIP archive) or a
    /// .pdf yields megabytes of U+FFFD on effectively a single line, which
    /// crashes CodeMirror outright once the md editor loads it. Conversion
    /// failures for these formats must therefore surface a real error instead
    /// of a "helpful" text fallback.
    pub fn is_binary_container(self) -> bool {
        matches!(self, Self::Docx | Self::Pdf | Self::Xlsx | Self::Pptx)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Md => "Markdown",
            Self::Txt => "纯文本",
            Self::Docx => "Word 文档 (.docx)",
            Self::Pdf => "PDF",
            Self::Html => "HTML",
            Self::Xlsx => "Excel (.xlsx)",
            Self::Pptx => "PowerPoint (.pptx)",
            Self::Other => "其他",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertResult {
    pub markdown: String,
    pub source_format: SourceFormat,
    pub source_sha1: String,
    pub source_mtime_unix_ms: i64,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FormatInfo {
    pub extension: &'static str,
    pub label: &'static str,
    pub via_markitdown: bool,
}

/// Formats the editor pipeline knows how to open. Order is the order they
/// appear in the OS file picker filter. `.md` is included for symmetry but
/// takes the existing direct read path.
pub fn supported_formats() -> Vec<FormatInfo> {
    vec![
        FormatInfo { extension: "md",   label: "Markdown",          via_markitdown: false },
        FormatInfo { extension: "txt",  label: "纯文本",            via_markitdown: false },
        FormatInfo { extension: "docx", label: "Word 文档",         via_markitdown: true  },
        FormatInfo { extension: "pdf",  label: "PDF",               via_markitdown: true  },
        FormatInfo { extension: "html", label: "HTML",             via_markitdown: true  },
        FormatInfo { extension: "xlsx", label: "Excel",             via_markitdown: true  },
        FormatInfo { extension: "pptx", label: "PowerPoint",        via_markitdown: true  },
    ]
}

/// Is the given extension one the editor pipeline can open? Used by the
/// file dialog filter to decide whether to surface the picker at all.
pub fn is_supported_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| supported_formats().iter().any(|f| f.extension.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

pub fn mtime_unix_ms(p: &Path) -> i64 {
    let mtime = match fs::metadata(p).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return 0,
    };
    match mtime.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => 0,
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default()
}

pub fn sha1_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let digest = h.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Read a file as markdown. For `.md` / `.txt` this is a direct byte read;
/// for the rest we ask markitdown and, if that fails, fall back to a
/// plain-text read so unsupported formats still open in the editor.
pub fn read_as_markdown(path: &Path) -> Result<ConvertResult, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取失败: {e}"))?;
    let sha1 = sha1_hex(&bytes);
    let mtime = mtime_unix_ms(path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = SourceFormat::from_extension(&ext);

    match format {
        SourceFormat::Md => Ok(ConvertResult {
            markdown: String::from_utf8_lossy(&bytes).into_owned(),
            source_format: format,
            source_sha1: sha1,
            source_mtime_unix_ms: mtime,
            fallback_used: false,
            fallback_reason: None,
        }),
        SourceFormat::Txt => Ok(ConvertResult {
            markdown: String::from_utf8_lossy(&bytes).into_owned(),
            source_format: format,
            source_sha1: sha1,
            source_mtime_unix_ms: mtime,
            fallback_used: false,
            fallback_reason: None,
        }),
        SourceFormat::Other => Err(format!(
            "不支持的格式: .{} (支持: {})",
            ext,
            supported_formats()
                .iter()
                .map(|f| f.extension)
                .collect::<Vec<_>>()
                .join(", ")
        )),
        _ => convert_with_markitdown(path, &bytes, format, sha1, mtime),
    }
}

fn convert_with_markitdown(
    path: &Path,
    bytes: &[u8],
    format: SourceFormat,
    sha1: String,
    mtime: i64,
) -> Result<ConvertResult, String> {
    let md = MarkItDown::new();
    // Pass the real extension explicitly. markitdown's convert_bytes(bytes, None)
    // sniffs magic bytes via `infer`; a .docx is a ZIP container, so sniffing
    // reports ".zip" and the converter never runs (markitdown would walk the
    // raw archive instead). Forcing the extension routes .docx/.pdf to their
    // real converters.
    let ext = extension_of(path);
    let opts = markitdown::model::ConversionOptions {
        file_extension: Some(ext.clone()),
        url: None,
        llm_client: None,
        llm_model: None,
    };
    match md.convert_bytes(bytes, Some(opts)) {
        Ok(Some(result)) => Ok(ConvertResult {
            markdown: result.text_content,
            source_format: format,
            source_sha1: sha1,
            source_mtime_unix_ms: mtime,
            fallback_used: false,
            fallback_reason: None,
        }),
        // For binary containers a plain-text fallback is actively harmful, not
        // merely useless: the decoded archive becomes one enormous line of
        // U+FFFD and takes the editor down with it (CodeMirror cannot survive
        // a multi-megabyte single line). Report a real error so the UI can say
        // "cannot parse this file" instead of crashing.
        Ok(None) if format.is_binary_container() => Err(format!(
            "无法解析 {} 文件：转换器未能识别该文档（可能已损坏、加密，或是不支持的新版格式）",
            ext
        )),
        Ok(None) => Ok(plain_text_fallback(path, bytes, format, sha1, mtime, "no converter matched")),
        Err(e) if format.is_binary_container() => {
            Err(format!("无法解析 {} 文件: {}", ext, e))
        }
        Err(e) => Ok(plain_text_fallback(path, bytes, format, sha1, mtime, &e.to_string())),
    }
}

fn plain_text_fallback(
    _path: &Path,
    bytes: &[u8],
    format: SourceFormat,
    sha1: String,
    mtime: i64,
    reason: &str,
) -> ConvertResult {
    ConvertResult {
        markdown: String::from_utf8_lossy(bytes).into_owned(),
        source_format: format,
        source_sha1: sha1,
        source_mtime_unix_ms: mtime,
        fallback_used: true,
        fallback_reason: Some(reason.to_string()),
    }
}

/// CLI entry for the converter sidecar (`weavine --md-convert-sidecar <path>`).
///
/// Runs `read_as_markdown`, prints the JSON result to stdout, and exits with a
/// status code. The signature is `!` because this is the whole purpose of the
/// spawned child — it must `exit`, never return into `main`'s Tauri path.
///
/// Why a separate process: markitdown 0.1.x's docx/pdf converters can
/// stack-overflow or double-panic on real-world files. `catch_unwind` cannot
/// catch those (stack overflow aborts; double panic aborts). Running the
/// converter in its own process means an abort only kills the child — the
/// parent `convert_external_file` sees a non-zero exit and reports a friendly
/// error. See `convert_external_file` below.
#[cfg(desktop)]
pub fn run_cli_convert(path: &str) -> ! {
    let p = PathBuf::from(path);
    match read_as_markdown(&p) {
        Ok(r) => match serde_json::to_string(&r) {
            Ok(json) => {
                // The parent parses this exact line. Keep stdout clean — only
                // the JSON, nothing else.
                println!("{json}");
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("conversion-result-serialize-failed: {e}");
                std::process::exit(2);
            }
        },
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

#[cfg(feature = "tauri")]
#[tauri::command(rename_all = "snake_case")]
pub async fn convert_external_file(path: String) -> Result<ConvertResult, String> {
    convert_external_file_via_sidecar(path).await
}

/// Spawn the converter as a *separate process* (the same `weavine` binary, run
/// with `--md-convert-sidecar`) and read its JSON result. This is the crash
/// isolation boundary: if the converter aborts (stack overflow / double panic),
/// only the child dies; we get a non-zero exit / no valid JSON and report a
/// friendly error instead of crashing the app.
#[cfg(feature = "tauri")]
async fn convert_external_file_via_sidecar(path: String) -> Result<ConvertResult, String> {
    use tokio::io::AsyncReadExt;
    use tokio::process::Command;
    use tokio::time::{timeout, Duration};

    let exe = std::env::current_exe().map_err(|e| format!("无法定位主程序路径: {e}"))?;

    let mut child = Command::new(&exe)
        .arg("--md-convert-sidecar")
        .arg(&path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("无法启动转换子进程: {e}"))?;

    let wait_fut = timeout(Duration::from_secs(120), async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        if let Some(mut so) = child.stdout.take() {
            so.read_to_end(&mut out).await?;
        }
        if let Some(mut se) = child.stderr.take() {
            se.read_to_end(&mut err).await?;
        }
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, out, err))
    });

    let (status, out, err) = match wait_fut.await {
        Ok(Ok(ok)) => ok,
        Ok(Err(e)) => return Err(format!("读取转换子进程输出失败: {e}")),
        Err(_) => {
            // `kill_on_drop(true)` cleans up the child if timeout fires.
            return Err("转换超时（>120s），已终止子进程".to_string());
        }
    };

    if !status.success() {
        let stderr = String::from_utf8_lossy(&err).trim().to_string();
        return Err(if stderr.is_empty() {
            "转换器无法解析该文件（子进程异常退出）".to_string()
        } else {
            format!("转换器无法解析该文件: {stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&out);
    serde_json::from_str::<ConvertResult>(&stdout)
        .map_err(|e| format!("转换结果解析失败: {e}（子进程输出: {}）", stdout.trim()))
}

#[cfg(feature = "tauri")]
#[tauri::command]
pub fn convert_supported_formats() -> Vec<FormatInfo> {
    supported_formats()
}
