#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# ShotScript 授权中心 · Termux 一键部署脚本（安卓手机）
# 用法：在 Termux 中执行  bash deploy-termux.sh
# 前置：已安装 Termux 并授予存储权限
# ============================================================
set -e

echo "==> [1/5] 安装依赖（nodejs / cloudflared）"
pkg update -y
pkg install -y nodejs cloudflared termux-services

echo "==> [2/5] 创建服务目录 ~/.shotscript-server"
mkdir -p ~/.shotscript-server/data
cp "$(dirname "$0")/index.js" ~/.shotscript-server/index.js

echo "==> [3/5] 检查密钥对"
if [ ! -f ~/.shotscript-server/private.pem ] || [ ! -f ~/.shotscript-server/public.pem ]; then
  echo "    ! 未找到密钥对，正在生成开发密钥…（发布版请替换为正式密钥）"
  openssl genrsa -out ~/.shotscript-server/private.pem 2048 2>/dev/null || \
    node -e "const {execFileSync}=require('child_process');const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});require('fs').writeFileSync(process.env.HOME+'/.shotscript-server/private.pem',privateKey.export({type:'pkcs8',format:'pem'}));require('fs').writeFileSync(process.env.HOME+'/.shotscript-server/public.pem',publicKey.export({type:'spki',format:'pem'}));"
  openssl rsa -in ~/.shotscript-server/private.pem -pubout -out ~/.shotscript-server/public.pem 2>/dev/null || true
fi

echo "==> [4/5] 写入管理 Token（请改为你自己的强口令）"
cat > ~/.shotscript-server/env.sh <<'EOF'
export SHOTSCRIPT_SERVER_PORT=8787
export SHOTSCRIPT_SERVER_TOKEN="CHANGE-ME-admin-token"
export SHOTSCRIPT_PRIVATE_KEY="$HOME/.shotscript-server/private.pem"
export SHOTSCRIPT_PUBLIC_KEY="$HOME/.shotscript-server/public.pem"
export SHOTSCRIPT_SERVER_DATA="$HOME/.shotscript-server/data"
EOF
sed -i "s/CHANGE-ME-admin-token/$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 24)/" ~/.shotscript-server/env.sh

echo "==> [5/5] 注册常驻服务"
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/shotscript-server.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
source ~/.shotscript-server/env.sh
termux-wake-lock
nohup node ~/.shotscript-server/index.js >> ~/.shotscript-server/server.log 2>&1 &
sleep 2
nohup cloudflared tunnel --url http://127.0.0.1:8787 >> ~/.shotscript-server/tunnel.log 2>&1 &
EOF
chmod +x ~/.termux/boot/shotscript-server.sh

echo ""
echo "================================================"
echo "  部署完成！重启 Termux 或手动执行："
echo "    bash ~/.termux/boot/shotscript-server.sh"
echo ""
echo "  启动后可查看公网地址（trycloudflare.com）："
echo "    grep -o 'https://[^ ]*trycloudflare.com' ~/.shotscript-server/tunnel.log"
echo ""
echo "  本地看板: http://127.0.0.1:8787"
echo "  管理 Token: $(grep TOKEN ~/.shotscript-server/env.sh | cut -d'\"' -f2)"
echo "================================================"
