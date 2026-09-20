use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    AeadCore, Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const NONCE_LEN: usize = 12;

fn tracing_warn(msg: &str) {
    let _ = msg;
    eprintln!("WARN: {msg}");
}

fn master_key_bytes() -> &'static [u8; 32] {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    KEY.get_or_init(|| {
        let raw: String = match std::env::var("WEAVINE_MASTER_KEY") {
            Ok(v) => v,
            Err(_) => {
                let seed = std::env::var("WEAVINE_DEV_MASTER_SEED")
                    .unwrap_or_else(|_| "weavine-dev-master".to_string());
                tracing_warn(&format!(
                    "WEAVINE_MASTER_KEY not set; deriving deterministic dev key from \
                     WEAVINE_DEV_MASTER_SEED. NEVER use this in production."
                ));
                let mut h = Sha256::new();
                h.update(seed.as_bytes());
                let out = h.finalize();
                B64.encode(out)
            }
        };
        let decoded = B64
            .decode(raw.as_bytes())
            .unwrap_or_else(|_| raw.as_bytes().to_vec());
        if decoded.len() != 32 {
            panic!(
                "WEAVINE_MASTER_KEY must decode to exactly 32 bytes (got {})",
                decoded.len()
            );
        }
        let mut k = [0u8; 32];
        k.copy_from_slice(&decoded);
        k
    })
}

fn cipher() -> Aes256Gcm {
    let key = Key::<Aes256Gcm>::from_slice(master_key_bytes());
    Aes256Gcm::new(key)
}

pub fn encrypt(plaintext: &[u8], aad: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let c = cipher();
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = c
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .expect("AES-GCM encrypt cannot fail with random nonce");
    (ct, nonce.as_slice().to_vec())
}

pub fn decrypt(ciphertext: &[u8], nonce: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    if nonce.len() != NONCE_LEN {
        return Err(format!("nonce length must be {NONCE_LEN}"));
    }
    let c = cipher();
    let n = Nonce::from_slice(nonce);
    c.decrypt(
        n,
        Payload {
            msg: ciphertext,
            aad,
        },
    )
    .map_err(|e| format!("decrypt: {e}"))
}
