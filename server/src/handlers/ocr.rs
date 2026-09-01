use axum::{
    body::Bytes,
    extract::{multipart::Multipart, ConnectInfo, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use std::cell::RefCell;
use std::sync::Arc;

use super::auth::{
    client_ip, extract_endpoint_auth, ocr_voice_rate_limit, EndpointAuth,
    OCR_VOICE_RL_LIMIT, OCR_VOICE_RL_WINDOW,
};

// Per-thread TessApi pool; re-inits when requested langs change.
thread_local! {
    static LEP_TESS: RefCell<Option<(String, leptess::tesseract::TessApi)>> = RefCell::new(None);
}

const CONFIDENCE_THRESHOLD: f32 = 0.65;

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
        _ => "chi_sim+eng",
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
    let has_han = text.chars().any(|c| is_han(c));
    let has_kana = text.chars().any(|c| matches!(c, '\u{3040}'..='\u{30FF}'));
    let has_cyr = text.chars().any(|c| matches!(c, '\u{0400}'..='\u{04FF}'));
    let has_lat = text.chars().any(|c| c.is_ascii_alphabetic());
    let has_cjk = has_han || has_kana;
    let mut out = vec!["eng".to_string()];
    if has_kana && !has_han {
        out.push("jpn".to_string());
    } else if has_han {
        out.push("chi_sim".to_string());
    }
    if has_cyr { out.push("rus".to_string()); }
    if !has_lat && !has_cjk && !has_cyr { out.clear(); }
    out
}

fn join_langs(langs: &[String]) -> String {
    if langs.is_empty() { return String::new(); }
    let mut parts: Vec<&str> = langs.iter().map(|s| s.as_str()).collect();
    parts.sort_by_key(|l| if *l == "eng" { 1 } else { 0 });
    parts.join("+")
}

fn with_tess<F, R>(data_path: &str, langs: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&mut leptess::tesseract::TessApi) -> Result<R, String>,
{
    LEP_TESS.with(|cell| {
        let mut cell = cell.borrow_mut();
        let reuse = match cell.as_ref() {
            Some((l, _)) => l == langs,
            None => false,
        };
        if !reuse {
            let api = leptess::tesseract::TessApi::new(Some(data_path), langs)
                .map_err(|e| format!("init leptess: {e}"))?;
            *cell = Some((langs.to_string(), api));
        }
        let api = &mut cell.as_mut().expect("tess pool initialized").1;
        f(api)
    })
}

struct OcrRun { text: String, confidence: f32 }

fn ocr_pass(path: &str, langs: &str) -> Result<OcrRun, String> {
    let tessdata = tessdata_path()
        .ok_or_else(|| "TESSDATA_PREFIX not set".to_string())?;
    let tessdata = tessdata.to_string_lossy().into_owned();
    let pix = leptess::leptonica::pix_read(std::path::Path::new(path))
        .ok_or_else(|| "unsupported image format".to_string())?;

    let psms = [
        leptess::capi::TessPageSegMode_PSM_AUTO,
        leptess::capi::TessPageSegMode_PSM_SINGLE_BLOCK,
        leptess::capi::TessPageSegMode_PSM_SPARSE_TEXT,
    ];
    let mut best: Option<OcrRun> = None;
    let mut best_conf: f32 = 0.0;
    for psm in psms {
        let run = with_tess(&tessdata, langs, |api| {
            unsafe {
                leptess::capi::TessBaseAPISetPageSegMode(api.raw, psm);
            }
            api.set_image(&pix);
            // leptess::recognize returns tesseract's int return code:
            // 0 = success, non-zero = error (see tesseract.h TessBaseAPIRecognize).
            let rc = api.recognize();
            if rc != 0 {
                return Err(format!("recognize: rc={rc}"));
            }
            let confidence = (api.mean_text_conf() as f32) / 100.0;
            let text = api.get_utf8_text()
                .map_err(|e| format!("ocr: {e:?}"))?;
            Ok(OcrRun { text, confidence })
        })?;
        let confidence = run.confidence;
        if confidence > best_conf {
            best_conf = confidence;
            best = Some(run);
        }
        if confidence >= CONFIDENCE_THRESHOLD { break; }
    }
    best.ok_or_else(|| "ocr produced no text".to_string())
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

fn is_label_line(text: &str) -> bool {
    let t = text.trim_start();
    if t.is_empty() { return false; }
    let idx = t.find(':').or_else(|| t.find('：'));
    let Some(idx) = idx else { return false; };
    let prefix: Vec<char> = t[..idx].chars().collect();
    if prefix.is_empty() || prefix.len() > 12 { return false; }
    let alpha = prefix.iter().filter(|c| c.is_alphabetic()).count();
    let digits = prefix.iter().filter(|c| c.is_ascii_digit()).count();
    alpha > 0 && digits == 0
}

// Scans digit runs so "138 1234 5678" is one phone, not three tokens.
fn extract_phones(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() || chars[i] == '+' {
            let mut j = i;
            let mut buf = String::new();
            let mut digits = 0usize;
            while j < chars.len() {
                let c = chars[j];
                if c.is_ascii_digit() {
                    digits += 1;
                    buf.push(c);
                } else if matches!(c, '+' | '-' | '(' | ')' | '.' | ' ') {
                    if !buf.is_empty() { buf.push(c); }
                } else {
                    break;
                }
                j += 1;
            }
            if digits >= 7 && digits <= 16 {
                let cleaned: String = buf.chars()
                    .filter(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '(' | ')' | '.'))
                    .collect();
                if looks_like_phone(&cleaned) && !out.iter().any(|p| p == &cleaned) {
                    out.push(cleaned);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// Extract a Chinese name from the first lines of the card.
/// Handles cases like "MY Mega Yitrium   林     科" where the
/// Chinese name is buried in a long English+CJK line.
fn extract_chinese_name(lines: &[OcrLine]) -> Option<String> {
    for line in lines.iter().take(6) {
        let text = line.text.trim();
        if text.is_empty() { continue; }
        if is_label_line(text) { continue; }
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
        if is_label_line(text) { continue; }
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

    let company_kw = [
        "公司", "co.,", "co.ltd", "co ltd", "pty ltd", "pty", "ltd", "llc",
        "inc", "corp", "gmbh", "株式会社", "有限会社", "有限责任公司",
        "工作室", "事务所", "集团", "& co",
    ];
    let title_kw = [
        "经理", "总监", "ceo", "cto", "cfo", "工程师",
        "designer", "manager", "director", "founder", "president",
        "总", "主管", "vp ", "svp", "head of", "lead", "architect",
        "pm", "product manager", "engineer", "developer",
        "销售", "市场", "运营",
    ];
    let addr_kw = [
        "地址", "add.", "addr", "street", "road", "路", "街", "区", "市",
        "building", "block", "suite", "floor", "楼", "层", "室",
    ];

    for line in lines.iter() {
        let text = line.text.trim();
        if text.is_empty() { continue; }

        for token in text.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '|' || c == '：' || c == ':') {
            let tok = token.trim().trim_start_matches("mailto:").trim_start_matches("MAILTO:");
            let tok = tok.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '.' && c != '-' && c != '@');
            if email.is_none() && looks_like_email(tok) {
                email = Some(tok.to_string());
            }
        }
        for p in extract_phones(text) {
            if phone.len() < 4 && !phone.iter().any(|x| x == &p) {
                phone.push(p);
            }
        }

        let lower = text.to_lowercase();
        let is_company = company_kw.iter().any(|k| lower.contains(k));
        let is_title = title_kw.iter().any(|k| lower.contains(k));
        let is_addr = addr_kw.iter().any(|k| lower.contains(k));

        if company.is_none() && is_company {
            company = Some(text.to_string());
        } else if title.is_none() && is_title {
            title = Some(text.to_string());
        } else if address.is_none() && is_addr {
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
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    State(pool): State<Arc<sqlx::PgPool>>,
    mut form: Multipart,
) -> Result<axum::Json<OcrResult>, (StatusCode, String)> {
    // Per-IP per-minute rate limit (v1.2.0 S2). Applied BEFORE auth so
    // an anonymous abuser can't burn CPU by spamming the endpoint.
    let ip = client_ip(&headers, Some(peer));
    if !ocr_voice_rate_limit().check(
        "ocr",
        "ip",
        &ip,
        OCR_VOICE_RL_LIMIT,
        OCR_VOICE_RL_WINDOW,
    ) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "OCR 请求过于频繁，请稍后再试".into(),
        ));
    }

    let _auth = match extract_endpoint_auth(&headers, pool.as_ref()).await? {
        EndpointAuth::ServiceKey => "service:weavine-default".to_string(),
        EndpointAuth::User { user_id, .. } => user_id,
        EndpointAuth::AnonymousDevice { install_id } => {
            let q = super::activation::check_and_bump_quota(&install_id, pool.as_ref(), "ocr").await?;
            if q.count > q.limit {
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    format!("daily ocr quota exceeded ({}/{})", q.count - 1, q.limit),
                ));
            }
            install_id
        }
    };
    super::activation::record_activation_hook(&headers, pool.as_ref(), "ocr").await;

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

    // leptess is !Send — run all Tesseract work on a blocking thread.
    let result = tokio::task::spawn_blocking(move || {
        let path = tmp.path().to_string_lossy().into_owned();
        let initial_langs = tess_langs().to_string();
        let mut best = ocr_pass(&path, &initial_langs)?;
        let mut used_langs = initial_langs.clone();

        let detected = detect_langs(&best.text);
        let detected_langs = join_langs(&detected);
        // Second pass only when confidence is low and detected langs differ.
        if best.confidence < CONFIDENCE_THRESHOLD
            && !detected_langs.is_empty()
            && detected_langs != initial_langs
        {
            if let Ok(retry) = ocr_pass(&path, &detected_langs) {
                if retry.confidence > best.confidence {
                    best = retry;
                    used_langs = detected_langs;
                }
            }
        }

        let langs_actual = detect_langs(&best.text);
        Ok::<_, String>((best.text, best.confidence, used_langs, langs_actual))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("ocr task: {e}")))?;

    let (raw_text, avg_confidence, langs, langs_actual) = result
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let lines: Vec<OcrLine> = raw_text.lines().map(|l| l.to_string()).filter(|l| !l.trim().is_empty())
        .map(|text| OcrLine { text }).collect();

    let fields = extract_fields(&lines);

    Ok(axum::Json(OcrResult {
        raw_text, lines, fields, avg_confidence,
        langs, langs_actual,
    }))
}
