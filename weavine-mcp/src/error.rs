use rmcp::model::ErrorCode;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("HTTP {0}: {1}")]
    Http(u16, String),

    #[error("上游错误: {0}")]
    Upstream(String),

    #[error("请求错误: {0}")]
    Request(String),

    #[error("序列化错误: {0}")]
    Serde(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("参数错误: {0}")]
    BadInput(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl McpError {
    pub fn http(status: u16, body: String) -> Self {
        if status == 401 || status == 403 {
            McpError::Auth(body)
        } else if status == 404 {
            McpError::NotFound(body)
        } else if status == 400 {
            McpError::BadInput(body)
        } else {
            McpError::Http(status, body)
        }
    }

    pub fn code(&self) -> ErrorCode {
        match self {
            McpError::Auth(_) => ErrorCode::INVALID_REQUEST,
            McpError::BadInput(_) => ErrorCode::INVALID_PARAMS,
            McpError::NotFound(_) => ErrorCode::INVALID_REQUEST,
            McpError::Http(_, _) | McpError::Upstream(_) | McpError::Request(_)
            | McpError::Serde(_) | McpError::Internal(_) => ErrorCode::INTERNAL_ERROR,
        }
    }

    pub fn message(&self) -> String {
        self.to_string()
    }
}

impl From<McpError> for rmcp::ErrorData {
    fn from(e: McpError) -> Self {
        rmcp::ErrorData::new(e.code(), e.message(), None)
    }
}

pub type McpResult<T> = std::result::Result<T, McpError>;
