---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 6dc4454c9eb3531220c128341ea14345_5c78828ea50411f1903b525400f8a581
    ReservedCode1: FcETRCeqsVdhcflCjlCneGraFujQWXhmYKEKvaLM1nG9I6HGVqctYkLtCLNg8fvTZVUBadt8OhJjPRj32/7nYDiIC5h4GO1LvSYskOnIBjH8JoyNW+J8EmGvMEDNlldtFJ2pVvSHd8x/CWqsOzMfe4QRhbPa/FddfnCe8/Fg4RN5NFXUPCX5Ccjszpg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 6dc4454c9eb3531220c128341ea14345_5c78828ea50411f1903b525400f8a581
    ReservedCode2: FcETRCeqsVdhcflCjlCneGraFujQWXhmYKEKvaLM1nG9I6HGVqctYkLtCLNg8fvTZVUBadt8OhJjPRj32/7nYDiIC5h4GO1LvSYskOnIBjH8JoyNW+J8EmGvMEDNlldtFJ2pVvSHd8x/CWqsOzMfe4QRhbPa/FddfnCe8/Fg4RN5NFXUPCX5Ccjszpg=
---

# ShotScript 授权中心 · 手机端无云同步方案

把「密钥台账 + 席位控制 + 用户身份记忆」的权威服务器，跑在用户自己的安卓手机上（Termux），
客户端（Electron App）通过公网地址直连手机服务端完成激活 / 登出 / 复验，全程不依赖任何云厂商。

## 一、架构总览

```
  ┌─────────────────────────────┐        ┌──────────────────────────────┐
  │  手机（Termux 常驻）          │        │  用户电脑（Electron App）       │
  │  node server/index.js        │  HTTPS │  src/license（激活/复验/登出）   │
  │  · 密钥台账 keys.json         │◄──────►│  src/remote（远程同步封装）      │
  │  · 用户身份 users.json        │        │  src/panel（本地面板，仅内网）    │
  │  · 事件流 events-*.jsonl      │        │                              │
  │  · 极简看板页（可选）           │        │                              │
  └───────────────┬─────────────┘        └──────────────────────────────┘
                  │  cloudflared tunnel --url http://127.0.0.1:8787
                  ▼
          https://xxxx.trycloudflare.com   （公网入口，客户端配置指向此地址）
```

## 二、席位与身份规则

| 版本 | 激活码 seats | 规则 |
|------|-------------|------|
| 个人 Pro | 1 | 一码一机：激活码绑定签发时的 uid；他人使用返回 `not_yours`；同 uid 换设备视为重绑允许 |
| 团队套餐 | 5 | 一码五席位：最多 5 个不同 uid 同时在线；满席返回 `seats_full`；有人登出释放一个席位 |
| 身份记忆 | — | 用户登出后**保留 Pro 身份**（users.json 中 edition 不清除）；换设备重登自动恢复 Pro，且不重复占位 |

关键设计：
- **登出释放席位**：`/api/v1/logout` 从 key 的 `online[]` 移除该用户，`left` 立即 +1；
- **重登恢复**：同 uid 再次激活时若已在 `online[]`，仅更新设备指纹不新增占用，避免换设备把自己挤下线；
- **离线降级**：客户端服务器不可达时保持本地激活态（软约束），不误杀用户；远程明确拒绝（满席/非本人）才回滚。

## 三、低内存 / 低发热设计（针对 16G 手机）

| 手段 | 说明 |
|------|------|
| 零依赖单文件 | 仅用 Node 内置 `http/crypto/fs`，无 npm 依赖，常驻内存 < 50MB |
| 事件驱动 | 无轮询定时器；唯一的 3 秒落盘 `setInterval` 使用 `.unref()`，不阻止进程、空闲不触发 |
| JSONL 追加写 | 事件按天分文件 append，不加载全量到内存；台账仅在小数据量时全量读写 |
| 请求短超时 | 客户端 2.5s 超时，手机端仅处理激活/登出/复验/统计这些低频请求 |
| 开机自启 | `~/.termux/boot` + `termux-wake-lock`，手机不关机即可 7×24 |

## 四、服务端 API（server/index.js）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/v1/activate` | 无 | 激活/重登：验签 + 席位判定 + 身份记忆 |
| POST | `/api/v1/logout` | 无 | 登出：释放席位 |
| POST | `/api/v1/verify` | 无 | 复验：查询 uid 是否仍在线 |
| POST | `/api/v1/telemetry` | 无 | 遥测事件接收（JSONL 落盘） |
| POST | `/api/v1/issue` | Bearer Token | 签发激活码（需私钥，seats=1/5） |
| GET  | `/api/v1/stats` | 无 | 近 7 日活跃 / 在线列表 / Pro 统计 |
| GET  | `/` | 无 | 极简看板页 |

启动：
```bash
export SHOTSCRIPT_SERVER_PORT=8787
export SHOTSCRIPT_SERVER_TOKEN=你的管理Token
export SHOTSCRIPT_PRIVATE_KEY=$HOME/.shotscript-server/private.pem
export SHOTSCRIPT_PUBLIC_KEY=$HOME/.shotscript-server/public.pem
node server/index.js
```

## 五、手机端部署（Termux）

```bash
# 1. 把 server/ 目录传到手机（scp / 网盘 / Termux 内 git clone 均可）
# 2. 在 Termux 中执行：
pkg install -y nodejs cloudflared termux-services
bash deploy-termux.sh        # 一键部署 + 注册开机自启

# 3. 启动并取公网地址
bash ~/.termux/boot/shotscript-server.sh
grep -o 'https://[^ ]*trycloudflare.com' ~/.shotscript-server/tunnel.log
```

> 生产建议：使用 Cloudflare 命名隧道（`cloudflared tunnel login` + 固定域名）替代随机 trycloudflare 地址，
> 这样客户端 `remote.json` 只需配置一次，不必跟随随机域名更新。

## 六、客户端接入

在**用户电脑**的 App 配置目录 `userData/remote.json` 写入：

```json
{ "serverUrl": "https://xxxx.trycloudflare.com" }
```

或设置环境变量 `SHOTSCRIPT_SERVER_URL`。未配置时客户端保持纯本机模式（离线可用），
配置后激活 / 登出 / 启动复验都会与手机端同步席位。管理 Token 通过 `SHOTSCRIPT_ADMIN_TOKEN` 注入签发场景。

## 七、激活码格式（个人/团队兼容）

激活码与既有格式完全一致，仅 payload 新增 `seats` 字段（serde 缺省=1，旧码兼容）：

```
base58( base64url(payload) + "." + base64url(RSA-SHA256 签名) )
payload = { "uid": "...", "type": "Pro", "exp": 1767225600, "seats": 1 | 5 }
```

- Rust：`license-core` 的 `LicensePayload` 增加 `#[serde(default="default_seats")] seats`；
  CLI 签发新增 `--seats` 参数；napi native 输出透传 `seats`。
- 本地面板（src/panel）：签发 UI 增加「个人 Pro / 团队套餐」下拉，签发接口接收 `seats`。

## 八、目录结构（本方案改动）

```
output/shotscript/
├── server/
│   ├── index.js              # 手机端授权中心（零依赖单文件）
│   └── deploy-termux.sh      # Termux 一键部署脚本
├── rust/
│   ├── crates/license-core/src/lib.rs   # payload 增加 seats（缺省 1）
│   ├── crates/native/src/lib.rs         # native 输出透传 seats
│   └── crates/tool/src/main.rs          # issue 支持 --seats
├── src/
│   ├── panel/index.js        # 签发 UI + 接口支持个人/团队
│   ├── remote/index.js       # 新增：远程同步封装（激活/登出/复验）
│   └── license/index.js      # 接入远程同步，席位明确拒绝才回滚
```
