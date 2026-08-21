//! Email transport for password reset (and any future transactional mail).
//!
//! Two implementations:
//!
//! - [`LogEmailSender`] — default. Writes the rendered message to `stderr`.
//!   Self-hosted installs where the operator doesn't run an SMTP relay
//!   copy the link from the log and send it to the user manually.
//! - [`SmtpEmailSender`] — enabled when the `smtp` feature is compiled in
//!   AND `SMTP_URL` / `SMTP_FROM` env vars are set at startup. Sends via
//!   `lettre` over the configured SMTP relay.
//!
//! Constructed via [`init_sender`], stored in a global `OnceLock`, and
//! fetched by handlers via [`sender`].

use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub body: String,
}

impl EmailMessage {
    pub fn new(to: impl Into<String>, subject: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            to: to.into(),
            subject: subject.into(),
            body: body.into(),
        }
    }
}

#[async_trait::async_trait]
pub trait EmailSender: Send + Sync {
    async fn send(&self, msg: EmailMessage) -> Result<(), EmailError>;
}

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("smtp error: {0}")]
    Smtp(String),
    #[error("misconfigured: {0}")]
    Misconfigured(String),
}

pub struct LogEmailSender;

#[async_trait::async_trait]
impl EmailSender for LogEmailSender {
    async fn send(&self, msg: EmailMessage) -> Result<(), EmailError> {
        eprintln!("[email] ── to: {}", msg.to);
        eprintln!("[email] ── subject: {}", msg.subject);
        for line in msg.body.lines() {
            eprintln!("[email] │ {line}");
        }
        eprintln!("[email] ── end");
        Ok(())
    }
}

#[cfg(feature = "smtp")]
pub struct SmtpEmailSender {
    transport: lettre::AsyncSmtpTransport<lettre::Tokio1Executor>,
    from: lettre::message::Mailbox,
}

#[cfg(feature = "smtp")]
impl SmtpEmailSender {
    pub fn new(url: &str, from: &str) -> Result<Self, EmailError> {
        let transport = lettre::AsyncSmtpTransport::<lettre::Tokio1Executor>::from_url(url)
            .map_err(|e| EmailError::Misconfigured(format!("smtp url: {e}")))?
        .build();
        let from: lettre::message::Mailbox = from
            .parse()
            .map_err(|e| EmailError::Misconfigured(format!("smtp from: {e}")))?;
        Ok(Self { transport, from })
    }
}

#[cfg(feature = "smtp")]
#[async_trait::async_trait]
impl EmailSender for SmtpEmailSender {
    async fn send(&self, msg: EmailMessage) -> Result<(), EmailError> {
        use lettre::AsyncTransport;
        let to: lettre::message::Mailbox = msg
            .to
            .parse()
            .map_err(|e| EmailError::Misconfigured(format!("recipient: {e}")))?;
        let email = lettre::Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(msg.subject)
            .body(msg.body)
            .map_err(|e| EmailError::Smtp(format!("build: {e}")))?;
        self.transport
            .send(email)
            .await
            .map_err(|e| EmailError::Smtp(format!("relay: {e}")))?;
        Ok(())
    }
}

static SENDER: OnceLock<Box<dyn EmailSender>> = OnceLock::new();

pub fn init_sender() {
    let boxed: Box<dyn EmailSender> = {
        #[cfg(feature = "smtp")]
        {
            if let (Ok(url), Ok(from)) = (std::env::var("SMTP_URL"), std::env::var("SMTP_FROM")) {
                if let Ok(smtp) = SmtpEmailSender::new(&url, &from) {
                    eprintln!("[email] SMTP sender configured (from={from})");
                    if SENDER.set(Box::new(smtp)).is_err() {
                        eprintln!("[email] SENDER already initialised");
                    }
                    return;
                }
                eprintln!("[email] SMTP env set but init failed; falling back to log sender");
            }
        }
        eprintln!("[email] using log sender (link prints to stderr)");
        Box::new(LogEmailSender)
    };
    if SENDER.set(boxed).is_err() {
        eprintln!("[email] SENDER already initialised");
    }
}

pub fn sender() -> &'static dyn EmailSender {
    &**SENDER.get_or_init(|| Box::new(LogEmailSender))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn log_sender_succeeds() {
        let s = LogEmailSender;
        s.send(EmailMessage::new(
            "user@example.com",
            "subject",
            "body line 1\nbody line 2",
        ))
        .await
        .unwrap();
    }
}
