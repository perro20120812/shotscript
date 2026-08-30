//! ShotScript 激活码校验原生模块（napi-rs）
//!
//! 编译产出 .node 原生模块，由 Electron 主进程加载。
//! 公钥硬编码内嵌（public_key.pem 由构建脚本嵌入），私钥永不进入本二进制。

#![deny(clippy::all)]

use napi_derive::napi;
use shotscript_license_core::{LicensePayload, VerifyResult, verify_activation_code};

/// 内嵌公钥（构建时从 public_key.pem 复制而来，见 rust/README 的密钥管理说明）
/// 开发用密钥对在 rust/keys/ 下；发布版需替换为正式公钥并重新编译。
pub const PUBLIC_KEY_PEM: &str = include_str!("public_key.pem");

#[napi(object)]
pub struct LicenseVerifyOutput {
    /// 是否校验通过
    pub ok: bool,
    /// 错误码字符串：ok / err_format / err_parse / err_signature / err_expired
    pub code: String,
    /// 人类可读消息
    pub message: String,
    /// 校验通过时的载荷（uid / type / exp）
    pub payload: Option<LicensePayloadJs>,
}

#[napi(object)]
pub struct LicensePayloadJs {
    pub uid: String,
    #[napi(js_name = "type")]
    pub license_type: String,
    pub exp: i64,
}

#[napi]
pub fn verify(activation_code: String) -> LicenseVerifyOutput {
    let res: VerifyResult = verify_activation_code(PUBLIC_KEY_PEM, &activation_code);
    LicenseVerifyOutput {
        ok: res.ok,
        code: res.code.as_str().to_string(),
        message: res.message,
        payload: res.payload.map(|p: LicensePayload| LicensePayloadJs {
            uid: p.uid,
            license_type: p.license_type,
            exp: p.exp,
        }),
    }
}

/// 返回内嵌公钥指纹（SHA-256 前 16 字节 hex），用于在关于页展示激活体系标识
#[napi]
pub fn public_key_fingerprint() -> String {
    use base64::Engine as _;
    let der = match base64::engine::general_purpose::STANDARD
        .decode(PUBLIC_KEY_PEM.lines().filter(|l| !l.starts_with("----")).collect::<String>())
    {
        Ok(b) => b,
        Err(_) => return "invalid".to_string(),
    };
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(&der);
    let digest = h.finalize();
    digest[..16].iter().map(|b| format!("{:02x}", b)).collect()
}
