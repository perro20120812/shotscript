---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 6dc4454c9eb3531220c128341ea14345_9e420300a3b111f1abe1525400e6dd8f
    ReservedCode1: 6BEu5tB5W/l0c43HFtWqWJygt0+mdmfVUetk4irGLm+dPu5i+mXpgAFUNpZKFNwi+9R8kDpq/cFBAHaYm/PASc/r0vHHhK6v8WPLfFiQVZNv7N63DwdQIWcC5llf/wpcrs6Ri9tWhZU76gQxmXdVIcvjK5QcK/DL0Hr5A5PTEkwGrs142+T3l4/4pdY=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 6dc4454c9eb3531220c128341ea14345_9e420300a3b111f1abe1525400e6dd8f
    ReservedCode2: 6BEu5tB5W/l0c43HFtWqWJygt0+mdmfVUetk4irGLm+dPu5i+mXpgAFUNpZKFNwi+9R8kDpq/cFBAHaYm/PASc/r0vHHhK6v8WPLfFiQVZNv7N63DwdQIWcC5llf/wpcrs6Ri9tWhZU76gQxmXdVIcvjK5QcK/DL0Hr5A5PTEkwGrs142+T3l4/4pdY=
---

# ShotScript Pro 激活体系（Rust 原生 RSA 签名校验）

> 功能块③ · 最终交付文档
> 替换原有前端占位校验（`SHOTPRO-2026`），升级为 Rust 原生模块 + RSA-SHA256 数字签名验签体系，防拆、防篡改、防伪造。

## 一、体系概览

```
┌─────────────────────────────────────────────────────────────┐
│ 开发者本机（仅此持有私钥）                                    │
│  rust/crates/tool 签发 CLI                                    │
│  generate-keypair → private.pem(0600) + public.pem           │
│  issue --uid --days --key  → 激活码字符串                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ 激活码交付用户
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 用户端 Electron 应用                                          │
│  渲染层 激活弹窗 app.js                                        │
│    │ API.license.verify(code)                                 │
│    ▼ IPC license:verify                                       │
│  主进程 src/license/index.js                                   │
│    │ require(rust/build/shotscript_license.node)              │
│    ▼                                                          │
│  Rust 原生模块（内嵌公钥）                                     │
│    RSA-SHA256 验签 → ok / err_format / err_parse /            │
│                       err_signature / err_expired              │
│    通过 → 持久化 userData/license.json → 解锁 Pro 页           │
└─────────────────────────────────────────────────────────────┘
```

## 二、端到端验证结果（2026-08-29）

| 场景 | 输入 | 结果 |
|------|------|------|
| 有效激活码 | `rust/keys/example-code.txt`（uid=demo-creator-2026, 365天, exp=1819547352） | ✅ `ok`，payload 正确，Pro 页解锁 |
| 篡改一位字符 | 有效码末位改为相邻 base58 字符 | ❌ `err_signature`，Pro 页保持未激活 |
| 垃圾输入 | `garbage###` | ❌ `err_format` |
| 空输入 | `""` | ❌ `err_format`（激活码为空） |
| 过期激活码 | 签发 days=-1（exp 已过） | ❌ `err_expired`（核心库单测覆盖） |

### 核心库单元测试（`cargo test -p shotscript-license-core`）
`roundtrip / tamper / expired / garbage` 4 项全部通过，覆盖：
- 签发→验签往返一致；
- 篡改 payload 或 signature 任一位均验签失败；
- 过期时间戳返回 `err_expired`；
- 非法编码返回 `err_format`。

### UI 截图验证（截图模式 `SHOTSCRIPT_SCREENSHOT=1`，产物在工程根目录）
| 截图 | 说明 |
|------|------|
| `screenshot-pro-gate.png` | 未激活：无限模板页显示"Pro 专属，请升级"遮罩 |
| `screenshot-llm-gate.png` | 未激活：本地润色页门控遮罩 |
| `screenshot-pro.png` | 输入真实 RSA 激活码后：Pro 页解锁并完成 3 条模板批量生成 |
| `screenshot-llm.png` | 激活态：本地润色页可用（真实引擎推理演示） |
| `screenshot-about.png` | 关于页"Pro 授权"区显示激活用户与有效期 |
| `screenshot-template/compress/storyboard.png` | 免费三页回归：功能不受影响 |

## 三、激活码格式与防拆机制

```
激活码 = base58( base64url(payload) + "." + base64url(signature) )
payload   = { "uid": 用户ID, "type": "Pro", "exp": 到期unix秒 }
signature = RSA-SHA256(payload 字节)  （RSASSA-PKCS1-v1_5）
```

- 公钥硬编码进 Rust 二进制（`crates/native/src/public_key.pem`），替换公钥文件须重编译，且旧激活码全部失效。
- 修改激活码任何一位 → 验签失败，无法伪造 / 篡改 / 续期。
- 原生模块加载失败时主进程**明确报错**（`err_native`），不静默放行，杜绝降级绕过。

## 四、持久化与自动复验

- 激活成功写入 `userData/license.json`（含 uid / type / exp / 激活时间），供下次启动复验。
- 启动时主进程自动 `restoreActivation`：验签 + 过期检查，通过才恢复 Pro 态；过期 / 篡改 / 公钥不匹配自动清除并回退未激活。
- 截图模式启动前清除持久化，保证门控图固定为未激活态。

## 五、密钥管理

- 开发密钥对：`rust/keys/private.pem`（0600，仅开发者本机）+ `public.pem`，示例激活码在 `example-code.txt`。
- ⚠️ `private.pem` **绝不打进应用 / 不上传仓库**；正式发布前在本机重新 `generate-keypair`，替换公钥后重编译，用新私钥签发真实用户激活码。
- 私钥丢失 = 无法再签发激活码（已签发的仍可用）；私钥泄露 = 可被伪造激活码，务必离线备份。

## 六、构建与签发命令速查

```bash
# 构建签发工具
cd rust && cargo build --release -p shotscript-tool

# 生成新密钥对（正式发布前）
./target/release/shotscript-tool generate-keypair --out ./keys
cp keys/public.pem crates/native/src/public_key.pem   # 复制公钥进 native 后重编译

# 构建原生模块（napi-rs）
cd crates/native && npx napi build --release --platform --arch
cp ../../target/release/libshotscript_license_native.dylib ../../build/shotscript_license.node

# 签发激活码
./target/release/shotscript-tool issue --uid <用户ID> --days 365 --key keys/private.pem

# 验签（联调）
./target/release/shotscript-tool verify --code <激活码> --pub keys/public.pem

# 单元测试
cargo test -p shotscript-license-core
```

## 七、本机工具链

- macOS arm64，rustc/cargo 1.98.0（aarch64-apple-darwin），经 rustup + rsproxy.cn 镜像安装。
- Node v24.15.0（`/opt/homebrew/bin/node`），Electron ^41.2.1。
- Windows 侧构建说明见 `rust/README.md` 第五节。
*（内容由AI生成，仅供参考）*
