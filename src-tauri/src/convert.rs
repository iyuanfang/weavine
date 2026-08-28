//! src-tauri/src/convert.rs — convert non-`.md` files (docx, pdf, html, …)
//! to markdown so the existing md editor pipeline can edit them.
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
use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy)]
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

#[derive(Debug, Serialize)]
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

pub fn sha1_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let digest = h.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where the editor should write edits when the user opens a non-md file.
/// Sibling `<name>.md` next to the original — keeps related files together
/// for the user. The caller is expected to refuse overwriting an existing
/// sibling without explicit confirmation.
pub fn sibling_md_path(original: &Path) -> PathBuf {
    let parent = original.parent().unwrap_or_else(|| Path::new(""));
    let stem = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled");
    parent.join(format!("{stem}.md"))
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
    match md.convert_bytes(bytes, None) {
        Ok(Some(result)) => Ok(ConvertResult {
            markdown: result.text_content,
            source_format: format,
            source_sha1: sha1,
            source_mtime_unix_ms: mtime,
            fallback_used: false,
            fallback_reason: None,
        }),
        Ok(None) => Ok(plain_text_fallback(path, bytes, format, sha1, mtime, "no converter matched")),
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

#[tauri::command(rename_all = "snake_case")]
pub fn convert_external_file(path: String) -> Result<ConvertResult, String> {
    let p = Path::new(&path);
    read_as_markdown(p)
}

#[tauri::command]
pub fn convert_supported_formats() -> Vec<FormatInfo> {
    supported_formats()
}

#[tauri::command(rename_all = "snake_case")]
pub fn convert_sibling_md_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    Ok(sibling_md_path(p).to_string_lossy().into_owned())
}