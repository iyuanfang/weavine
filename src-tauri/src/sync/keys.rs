// Embedded RSA public key for JWT verification.
// For v0.2.0b, we do NOT verify JWT on the desktop client (all requests
// are online against the server which validates). This key is kept as
// infrastructure for v0.2.0c offline verification.
//
// Generated: 2026-07-05, server /www/weavine/jwt-public.pem

#[allow(dead_code)]
pub const JWT_RSA_PUBLIC_KEY_PEM: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LeheY3YR88H1AO2eWEO
VHknUVZAaoD6Xd9X5xEyO4DoZ51mbvtIN+PLlhwL5ZS+oFNjnIKmSarQ928W+77i
EhEsUS8FjdxF2zbsKah1Xa/rMFfykvNS8h/tDUSF/AdBjYtuyozULqtj0DVIocu2
uK9Xq92A9sKfDJtGv8jx0jQNi9oTU1Ej3K+iDprTNps+A3UoK9GTlq8PJI8yId23
lmNOblvtvsV/tKbl4D3x4DIoihm52H7lUP+OFHkJ6m/oRBbFht21LZv86UOe2mZC
NkoIafWrg4oACPa/RyMFmeHHkdZ3Vm+YUoTq4c2OzRvXPRSOB3VR0lWjXeQ6e2wA
UQIDAQAB
-----END PUBLIC KEY-----"#;

/// PEM-encoded RSA public key as bytes (for jsonwebtoken crate).
#[allow(dead_code)]
pub fn decoding_key() -> jsonwebtoken::DecodingKey {
    jsonwebtoken::DecodingKey::from_rsa_pem(JWT_RSA_PUBLIC_KEY_PEM.as_bytes())
        .expect("embedded public key is valid PEM")
}
