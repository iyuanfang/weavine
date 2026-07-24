use jsonwebtoken::{DecodingKey, EncodingKey};
use std::fmt;
use std::fs;

pub struct Keys {
    pub encoding: EncodingKey,
    pub decoding: DecodingKey,
}

impl fmt::Debug for Keys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Keys").finish_non_exhaustive()
    }
}

impl Keys {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let priv_path = std::env::var("JWT_PRIVATE_KEY_PATH")
            .unwrap_or_else(|_| "jwt-private.pem".to_string());
        let pub_path = std::env::var("JWT_PUBLIC_KEY_PATH")
            .unwrap_or_else(|_| "jwt-public.pem".to_string());
        let priv_pem = fs::read(&priv_path)
            .map_err(|e| format!("read {}: {}", priv_path, e))?;
        let pub_pem = fs::read(&pub_path)
            .map_err(|e| format!("read {}: {}", pub_path, e))?;
        Ok(Self {
            encoding: EncodingKey::from_rsa_pem(&priv_pem)?,
            decoding: DecodingKey::from_rsa_pem(&pub_pem)?,
        })
    }
}
