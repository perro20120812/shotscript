---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 6dc4454c9eb3531220c128341ea14345_9dac9d86a3b111f1abe1525400e6dd8f
    ReservedCode1: I0r7NSkSqthl4ZOVktgnjDc7kQEyi7X7yBcBOL4Y8ujmHEPaLqSTkY+MapCv5AHVWuhmIW5V8OKvOJsEyZfUo4Ga13avhTUJmsDFSlV+jldJyzUnsWXl2KfXKkMmtJ2pXmyqH16TfYHQvUXtk50Hcrsm4WMH9gdxDRLhHUhjjRGdUVKZZe1XrHF8xZk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 6dc4454c9eb3531220c128341ea14345_9dac9d86a3b111f1abe1525400e6dd8f
    ReservedCode2: I0r7NSkSqthl4ZOVktgnjDc7kQEyi7X7yBcBOL4Y8ujmHEPaLqSTkY+MapCv5AHVWuhmIW5V8OKvOJsEyZfUo4Ga13avhTUJmsDFSlV+jldJyzUnsWXl2KfXKkMmtJ2pXmyqH16TfYHQvUXtk50Hcrsm4WMH9gdxDRLhHUhjjRGdUVKZZe1XrHF8xZk=
---

# ShotScript 激活体系（Rust 原生 RSA 签名校验）

ShotScript Pro 版的激活码校验核心，采用 **Rust 原生模块（napi-rs）+ RSA-SHA256 数字签名**，
公钥硬编码内嵌进 Rust 二进制，防拆、防篡改、防伪造。免费开源版不包含本目录。

## 一、激活码格式

```
激活码 = base58( base64url(payload) + "." + base64url(signature) )
payload   = base64url( JSON { "uid": "<用户ID>", "type": "Pro", "exp": <到期unix秒> } )
signature = base64url( RSA-SHA256( base64url(payload) 原始字节 ) )
```

- 用户拿到的是一个纯字符串激活码（base58 字符集），复制粘贴即可。
- 到期时间由签名保证，改任何一位字符都会导致验签失败（`err_signature`）。

## 二、工程结构

```
rust/
├── Cargo.toml                  # workspace
├── crates/
│   ├── license-core/           # 纯 Rust 核心库：签发 / 验签 / 错误码（无 napi 依赖，可单元测试）
│   ├── native/                 # napi-rs 原生模块（打包进应用，内嵌公钥）
│   │   ├── src/lib.rs
│   │   └── src/public_key.pem  # 内嵌公钥（由开发者用 generate-keypair 产出后复制到此）
│   └── tool/                   # 签发 CLI（仅开发者本机使用，绝不打包）
├── build/shotscript_license.node  # 构建产物：Electron 主进程加载的原生模块
├── keys/                       # 开发用密钥对（私钥 0600，绝不分发；正式发布请替换）
│   ├── private.pem             # ⚠️ 私钥，仅开发者本机持有
│   ├── public.pem              # 公钥
│   └── example-code.txt        # 开发示例激活码（联调用，见下）
```

## 三、构建命令（macOS arm64 本机）

```bash
cd rust

# 1) 构建签发工具（仅开发者本机）
cargo build --release -p shotscript-tool
# 产物: target/release/shotscript-tool

# 2) 生成密钥对（正式发布前执行一次，妥善备份私钥）
./target/release/shotscript-tool generate-keypair --bits 2048 --out ./keys

# 3) 把公钥复制进 native（内嵌到二进制，重新编译才生效）
cp keys/public.pem crates/native/src/public_key.pem

# 4) 构建原生模块（napi-rs）
cd crates/native
npx napi build --release --platform --arch
# 或: cargo build --release
# 产物 dylib 复制为 shotscript_license.node
cp ../../target/release/libshotscript_license_native.dylib ../../build/shotscript_license.node

# 5) 运行核心库单元测试（roundtrip / tamper / expired / garbage）
cargo test -p shotscript-license-core
```

## 四、签发激活码（仅开发者本机，用私钥）

```bash
# 为用户 alice 签发 365 天 Pro 激活码
./target/release/shotscript-tool issue --uid alice --days 365 --key keys/private.pem

# 校验某条激活码是否有效（联调用）
./target/release/shotscript-tool verify --code <激活码> --pub keys/public.pem
```

## 五、Windows 侧构建说明

本工程当前在 macOS arm64 上构建验证。Windows 侧需要：

1. 安装 Rust 工具链：`rustup-init.exe`（stable）。
2. 安装 napi-rs 依赖的构建环境：Node.js LTS + `npm i -g @napi-rs/cli`；MSVC Build Tools（VS 2019+，含 C++ 桌面开发）。
3. 在 `rust/crates/native` 下执行 `napi build --release --platform --arch`，
   产出 `shotscript_license.win32-x64-msvc.node`，复制到 `rust/build/shotscript_license.node`。
4. 主进程 `src/license/index.js` 按 `process.platform` 选择对应 .node 文件名即可（当前固定名，跨平台需微调）。

> napi-rs 原生模块为 ABI 稳定（Node-API），同一份源码编译的 .node 可被 Electron 主进程直接 require，
> 无需针对 Electron 单独重编译（Node-API 版本兼容即可）。

## 六、密钥管理方案（安全要点）

- 私钥 `keys/private.pem` **只存在开发者本机**，权限 0600，绝不打进应用、绝不上传到任何仓库/服务器。
- 公钥经 `generate-keypair` 产出后，复制进 `crates/native/src/public_key.pem`，随 Rust 源码一起**编译进二进制**，
  应用内无法通过替换文件绕过（改公钥需重新编译，且旧激活码全部失效，相当于废掉发布版本）。
- 正式发布流程：本机重新 `generate-keypair` 生成新密钥对 → 复制新公钥进 native → 重编译原生模块 →
  用新私钥签发真实用户激活码。
- 泄露私钥 = 任何人都能伪造激活码，务必离线保存备份（如密码管理器 / 冷存储）。

## 七、错误码对照（IPC license.verify 返回）

| code           | 含义                 | 渲染层提示 |
|----------------|----------------------|------------|
| ok             | 校验通过             | 激活成功，解锁 Pro |
| err_format     | 编码 / 结构错误      | 激活码格式无效 |
| err_parse      | payload 解析失败     | 激活码解析失败 |
| err_signature  | 验签失败（篡改/伪造）| 激活码无效或已被篡改 |
| err_expired    | 已过期               | 激活码已过期 |
| err_native     | 原生模块加载/调用失败 | 激活校验模块不可用 |

## 八、开发示例激活码

`rust/keys/example-code.txt` 中存放一条开发密钥签发的示例激活码
（uid=`demo-creator-2026`，365 天，exp=`1819547352`），用于应用内联调与截图验证。
它只对**开发公钥**有效；正式发布使用新密钥对后，该码自动失效。
*（内容由AI生成，仅供参考）*
