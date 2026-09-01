//! ShotScript 激活码核心库（纯 Rust，无 napi 依赖）
//!
//! 激活码格式：
//!   activationCode = base58( base64url(payload) + "." + base64url(signature) )
//!   payload        = base64url( JSON { "uid": "...", "type": "Pro", "exp": <unix_ts> } )
//!   signature      = base64url( RSA-SHA256( base64url(payload) 的原始字节 ) )
//!
//! 验签使用 RSASSA-PKCS1-v1_5 + SHA-256。

use base64::Engine as _;
use rsa::pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey};
use rsa::pkcs1v15::{Signature, SigningKey, VerifyingKey};
use rsa::pkcs8::{DecodePublicKey, EncodePublicKey};
use rsa::signature::{SignatureEncoding, Signer, Verifier};
use rsa::{RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// base64url 引擎（无填充，URL_SAFE 字母表）
fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// 激活载荷
///
/// seats：席位上限。1=个人 Pro（一码一机），5=团队套餐（一码五席位）。
/// serde 缺省为 1，保证旧版签发（无 seats 字段）仍可解析为个人 Pro。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LicensePayload {
    pub uid: String,
    #[serde(rename = "type")]
    pub license_type: String,
    pub exp: i64,
    #[serde(default = "default_seats")]
    pub seats: i64,
}

fn default_seats() -> i64 {
    1
}

/// 验签结果
#[derive(Debug, Clone)]
pub struct VerifyResult {
    pub ok: bool,
    pub code: ErrorCode,
    pub message: String,
    pub payload: Option<LicensePayload>,
}

/// 错误码（稳定，供上层映射为明确提示）
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum ErrorCode {
    Ok = 0,
    ErrFormat = 1, // 激活码格式/编解码错误
    ErrParse = 2,  // payload JSON 解析失败
    ErrSignature = 3, // 验签失败（篡改或伪造）
    ErrExpired = 4, // 已过期
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::Ok => "ok",
            ErrorCode::ErrFormat => "err_format",
            ErrorCode::ErrParse => "err_parse",
            ErrorCode::ErrSignature => "err_signature",
            ErrorCode::ErrExpired => "err_expired",
        }
    }
    pub fn from_u8(v: u8) -> ErrorCode {
        match v {
            0 => ErrorCode::Ok,
            1 => ErrorCode::ErrFormat,
            2 => ErrorCode::ErrParse,
            3 => ErrorCode::ErrSignature,
            _ => ErrorCode::ErrExpired,
        }
    }
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 生成 RSA 密钥对，返回 (private_pem, public_pem)
pub fn generate_keypair(bits: usize) -> Result<(String, String), String> {
    let mut rng = rsa::rand_core::OsRng;
    let priv_key = RsaPrivateKey::new(&mut rng, bits).map_err(|e| e.to_string())?;
    let pub_key = RsaPublicKey::from(&priv_key);

    let private_pem = priv_key
        .to_pkcs1_pem(rsa::pkcs1::LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    let public_pem = pub_key
        .to_public_key_pem(rsa::pkcs8::LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    Ok((private_pem, public_pem))
}

/// 用私钥签发一条激活码
pub fn issue_activation_code(private_pem: &str, payload: &LicensePayload) -> Result<String, String> {
    let priv_key = RsaPrivateKey::from_pkcs1_pem(private_pem).map_err(|e| e.to_string())?;

    let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let b64_payload = b64().encode(payload_json.as_bytes());

    // 签名对象：base64url(payload) 的原始字节（RSASSA-PKCS1-v1_5 + SHA-256）
    let signing_key = SigningKey::<sha2::Sha256>::new(priv_key);
    let sig: Signature = signing_key.sign(b64_payload.as_bytes());
    let b64_sig = b64().encode(sig.to_bytes());

    let inner = format!("{}.{}", b64_payload, b64_sig);
    Ok(bs58::encode(inner.as_bytes()).into_string())
}

/// 验签一条激活码（公钥）
pub fn verify_activation_code(public_pem: &str, code: &str) -> VerifyResult {
    let fail = |code: ErrorCode, message: &str| VerifyResult {
        ok: false,
        code,
        message: message.to_string(),
        payload: None,
    };

    let code = code.trim();
    if code.is_empty() {
        return fail(ErrorCode::ErrFormat, "激活码为空");
    }

    // base58 解码
    let inner = match bs58::decode(code).into_vec() {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return fail(ErrorCode::ErrFormat, "激活码编码无效"),
        },
        Err(_) => return fail(ErrorCode::ErrFormat, "激活码编码无效"),
    };

    // 按 '.' 分割 payload / signature
    let mut parts = inner.splitn(2, '.');
    let b64_payload = match parts.next() {
        Some(p) if !p.is_empty() => p,
        _ => return fail(ErrorCode::ErrFormat, "激活码结构缺失 payload"),
    };
    let b64_sig = match parts.next() {
        Some(p) if !p.is_empty() => p,
        _ => return fail(ErrorCode::ErrFormat, "激活码结构缺失签名"),
    };

    // 解码 payload
    let payload_bytes = match b64().decode(b64_payload) {
        Ok(b) => b,
        Err(_) => return fail(ErrorCode::ErrFormat, "payload 解码失败"),
    };
    let payload: LicensePayload = match serde_json::from_slice(&payload_bytes) {
        Ok(p) => p,
        Err(_) => return fail(ErrorCode::ErrParse, "payload 解析失败"),
    };

    // 验签
    let pub_key = match RsaPublicKey::from_public_key_pem(public_pem) {
        Ok(k) => k,
        Err(_) => return fail(ErrorCode::ErrFormat, "内嵌公钥无效"),
    };
    let sig_bytes = match b64().decode(b64_sig) {
        Ok(b) => b,
        Err(_) => return fail(ErrorCode::ErrSignature, "签名解码失败"),
    };
    let sig = match Signature::try_from(sig_bytes.as_slice()) {
        Ok(s) => s,
        Err(_) => return fail(ErrorCode::ErrSignature, "签名无效"),
    };
    let verifying_key = VerifyingKey::<sha2::Sha256>::new(pub_key);
    if verifying_key.verify(b64_payload.as_bytes(), &sig).is_err() {
        return fail(ErrorCode::ErrSignature, "签名校验失败（激活码无效或已被篡改）");
    }

    // 类型校验
    if payload.license_type != "Pro" {
        return fail(ErrorCode::ErrSignature, "激活类型不匹配");
    }

    // 过期校验
    if payload.exp < now_ts() {
        return fail(ErrorCode::ErrExpired, "激活码已过期");
    }

    VerifyResult {
        ok: true,
        code: ErrorCode::Ok,
        message: "ok".to_string(),
        payload: Some(payload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> (String, String) {
        generate_keypair(1024).unwrap()
    }

    #[test]
    fn roundtrip_ok() {
        let (priv_pem, pub_pem) = keypair();
        let payload = LicensePayload {
            uid: "dev-user-001".into(),
            license_type: "Pro".into(),
            exp: now_ts() + 86400 * 365,
        };
        let code = issue_activation_code(&priv_pem, &payload).unwrap();
        let res = verify_activation_code(&pub_pem, &code);
        assert!(res.ok, "{}", res.message);
        assert_eq!(res.payload.unwrap().uid, "dev-user-001");
    }

    #[test]
    fn tamper_fails() {
        let (priv_pem, pub_pem) = keypair();
        let payload = LicensePayload {
            uid: "u1".into(),
            license_type: "Pro".into(),
            exp: now_ts() + 86400,
        };
        let code = issue_activation_code(&priv_pem, &payload).unwrap();
        let mut bytes: Vec<u8> = bs58::decode(code.as_str()).into_vec().unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        let tampered = bs58::encode(&bytes[..]).into_string();
        let res = verify_activation_code(&pub_pem, &tampered);
        assert!(!res.ok);
        assert_eq!(res.code, ErrorCode::ErrSignature);
    }

    #[test]
    fn expired_fails() {
        let (priv_pem, pub_pem) = keypair();
        let payload = LicensePayload {
            uid: "u1".into(),
            license_type: "Pro".into(),
            exp: now_ts() - 100,
        };
        let code = issue_activation_code(&priv_pem, &payload).unwrap();
        let res = verify_activation_code(&pub_pem, &code);
        assert!(!res.ok);
        assert_eq!(res.code, ErrorCode::ErrExpired);
    }

    #[test]
    fn garbage_fails() {
        let (_, pub_pem) = keypair();
        let res = verify_activation_code(&pub_pem, "not-a-valid-code-####");
        assert!(!res.ok);
        assert_eq!(res.code, ErrorCode::ErrFormat);
    }
}
