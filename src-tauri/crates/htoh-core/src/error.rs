use crate::money::MoneyError;
use crate::tally::TallyError;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Money(#[from] MoneyError),
    #[error("{0}")]
    Tally(#[from] TallyError),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    Forbidden(String),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::Db(_) => "db",
            CoreError::Money(_) => "money",
            CoreError::Tally(_) => "tally",
            CoreError::NotFound(_) => "not_found",
            CoreError::Forbidden(_) => "forbidden",
            CoreError::Validation(_) => "validation",
            CoreError::Io(_) => "io",
            CoreError::Other(_) => "other",
        }
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Other(e.to_string())
    }
}

/// Wire form of an error, so the UI can branch on `code`.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl From<CoreError> for ErrorPayload {
    fn from(e: CoreError) -> Self {
        ErrorPayload {
            code: e.code(),
            message: e.to_string(),
        }
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
