use axum::{
    body::Bytes,
    extract::{multipart::Multipart, State},
    http::{HeaderMap, StatusCode},
};
use leptess::LepTess;
use serde::Serialize;
use std::sync::Arc;

use super::auth::extract_auth_with_device;

fn tessdata_path() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("TESSDATA_PREFIX") {
        return Some(std::path::PathBuf::from(p));
    }
    let candidates = [
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/local/share/tessdata",
        "/opt/homebrew/share/tessdata",
    ];
    for c in candidates {
        let p = std::path::PathBuf::from(c);
        if p.is_dir() { return Some(p); }
    }
    None
}

fn tess_langs() -> &'static str {
    match std::env::var("TESS_LANGS") {
        Ok(v) if !v.is_empty() => Box::leak(v.into_boxed_str()),
        _ => "chi_sim+chi_tra+eng",
    }
}

#[derive(Debug, Serialize)]
pub struct OcrLine { pub text: String }

#[derive(Debug, Serialize)]
pub struct OcrFields {
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub email: Option<String>,
    pub phone: Vec<String>,
    pub address: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OcrResult {
    pub raw_text: String,
    pub lines: Vec<OcrLine>,
    pub fields: OcrFields,
    pub avg_confidence: f32,
    pub langs: String,
    pub langs_actual: Vec<String>,
}

fn detect_langs(text: &str) -> Vec<String> {
    let has_cjk = text.chars().any(|c| matches!(c,
        '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{3040}'..='\u{30FF}'));
    let has_lat = text.chars().any(|c| c.is_ascii_alphabetic());
    let mut out = vec!["eng".to_string()];
    if has_cjk { out.push("chi_sim".to_string()); }
    if !has_lat && !has_cjk { out.clear(); }
    out
}

fn looks_like_phone(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.contains('@') { return false; }
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 7 || digits.len() > 16 { return false; }
    let cn_mobile = digits.len() == 11 && digits.starts_with('1');
    let intl = s.starts_with('+');
    cn_mobile || intl || (digits.len() >= 7 && digits.len() <= 13)
}

fn looks_like_email(s: &str) -> bool {
    let s = s.trim();
    let Some(at) = s.find('@') else { return false; };
    let (local, domain) = s.split_at(at);
    let domain = &domain[1..];
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn is_han(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'   // CJK Unified Ideographs
        | '\u{3400}'..='\u{4DBF}' // CJK Extension A
        | '\u{F900}'..='\u{FAFF}' // CJK Compatibility Ideographs
    )
}

/// Extract a Chinese name from the first lines of the card.
/// Handles cases like "MY Mega Yitrium   林     科" where the
/// Chinese name is buried in a long English+CJK line.
fn extract_chinese_name(lines: &[OcrLine]) -> Option<String> {
    for line in lines.iter().take(6) {
        let text = line.text.trim();
        if text.is_empty() { continue; }
        let han: Vec<char> = text.chars().filter(|c| is_han(*c)).collect();
        if han.len() < 2 || han.len() > 5 { continue; }
        let joined: String = han.into_iter().collect();
        // Skip if the Han chars look like company/title keywords
        if joined.contains("公司") || joined.contains("地址")
            || joined.contains("电话") || joined.contains("邮箱")
            || joined.contains("中国") || joined.contains("上海")
            || joined.contains("区") || joined.contains("市")
            || joined.contains("楼") || joined.contains("室")
            || joined.contains("号") || joined.contains("街")
            || joined.contains("路")
        {
            continue;
        }
        return Some(joined);
    }
    None
}

/// English name fallback for non-CJK cards.
fn extract_english_name(lines: &[OcrLine]) -> Option<String> {
    for (idx, line) in lines.iter().enumerate() {
        if idx >= 4 { break; }
        let text = line.text.trim();
        if text.is_empty() || text.chars().count() > 12 { continue; }
        let digits = text.chars().filter(|c| c.is_ascii_digit()).count();
        let punct = text.chars().filter(|c| matches!(c, '@' | '/' | '.')).count();
        if digits > 0 || punct > 0 { continue; }
        let lower = text.to_lowercase();
        if lower.contains("tel") || lower.contains("phone")
            || lower.contains("mail") || lower.contains("公司")
            || lower.contains("地址")
        {
            continue;
        }
        return Some(text.to_string());
    }
    None
}

fn extract_fields(lines: &[OcrLine]) -> OcrFields {
    let mut phone: Vec<String> = Vec::new();
    let mut email: Option<String> = None;
    let mut name: Option<String> = None;
    let mut company: Option<String> = None;
    let mut title: Option<String> = None;
    let mut address: Option<String> = None;

    for (idx, line) in lines.iter().enumerate() {
        let text = line.text.trim();
        if text.is_empty() { continue; }

        for token in text.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '|' || c == '：' || c == ':') {
            let tok = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '.' && c != '-' && c != '@');
            if looks_like_email(tok) && email.is_none() {
                email = Some(tok.to_string());
            } else if looks_like_phone(tok) && phone.len() < 4 && !phone.iter().any(|p| p == tok) {
                phone.push(tok.to_string());
            }
        }

        let lower = text.to_lowercase();
        if company.is_none()
            && (lower.contains("公司") || lower.contains("co.,") || lower.contains("co.ltd")
                || lower.contains("inc") || lower.contains("corp") || lower.contains("ltd")
                || lower.contains("工作室") || lower.contains("事务所") || lower.contains("集团"))
        {
            company = Some(text.to_string());
        } else if title.is_none()
            && (lower.contains("经理") || lower.contains("总监") || lower.contains("ceo")
                || lower.contains("cto") || lower.contains("cfo") || lower.contains("工程师")
                || lower.contains("designer") || lower.contains("manager") || lower.contains("director")
                || lower.contains("founder") || lower.contains("president")
                || lower.contains("总") || lower.contains("主管"))
        {
            title = Some(text.to_string());
        } else if address.is_none()
            && (lower.contains("地址") || lower.contains("add.") || lower.contains("addr")
                || lower.contains("street") || lower.contains("road")
                || lower.contains("路") || lower.contains("街")
                || lower.contains("区") || lower.contains("市"))
        {
            address = Some(text.to_string());
        }
    }

    let zh = extract_chinese_name(lines);
    let en = extract_english_name(lines);
    let name = match (zh, en) {
        (Some(z), Some(e)) if z.chars().count() <= 4 && e.chars().count() + z.chars().count() + 3 <= 24 => {
            Some(format!("{} ({})", z, e))
        }
        (Some(z), _) => Some(z),
        (None, Some(e)) => Some(e),
        (None, None) => None,
    };

    OcrFields { name, company, title, email, phone, address }
}

pub async fn extract_card(
    headers: HeaderMap,
    State(pool): State<Arc<sqlx::PgPool>>,
    mut form: Multipart,
) -> Result<axum::Json<OcrResult>, (StatusCode, String)> {
    let (_auth, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;

    let mut image_bytes: Option<Bytes> = None;
    while let Some(field) = form.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        if field.name() == Some("file") || field.name() == Some("image") {
            image_bytes = Some(field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?);
            break;
        }
    }
    let image_bytes = image_bytes.ok_or_else(|| (StatusCode::BAD_REQUEST, "missing file".into()))?;

    let tmp = tempfile::Builder::new().suffix(".png").tempfile()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tmpfile: {e}")))?;
    std::fs::write(tmp.path(), &image_bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write tmp: {e}")))?;

    let pix = leptess::leptonica::pix_read(tmp.path())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "unsupported image format".to_string()))?;

    let path = tessdata_path()
        .ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, "TESSDATA_PREFIX not set".to_string()))?;
    let langs = tess_langs();
    let mut api = LepTess::new(Some(path.to_str().unwrap()), langs)
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, format!("init leptess: {e:?}")))?;
    api.set_image(tmp.path().to_str().unwrap());
    let _ = api.recognize();
    let raw_text = api.get_utf8_text()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("ocr: {e:?}")))?
        .to_string();
    let avg_confidence = (api.mean_text_conf() as f32) / 100.0;
    let _ = pix;

    let lines: Vec<OcrLine> = raw_text.lines().map(|l| l.to_string()).filter(|l| !l.trim().is_empty())
        .map(|text| OcrLine { text }).collect();

    let fields = extract_fields(&lines);
    let langs_actual = detect_langs(&raw_text);

    Ok(axum::Json(OcrResult {
        raw_text, lines, fields, avg_confidence,
        langs: langs.to_string(), langs_actual,
    }))
}