#!/bin/bash
# 修车店 POS 系统 - 源码版安装 (Mac / Linux) / Source install
# 使用方法 / Usage: chmod +x install.sh && ./install.sh
# Installs the exact locked dependencies (npm ci), builds the production version once and
# creates .env.local with a random login secret. Start it with ./start.sh (production server,
# this computer only unless WORKSHOP_LAN=1).
set -e
echo "=========================================="
echo "  修车店 POS 系统 - 源码版安装 / Source install"
echo "=========================================="

if ! command -v node &> /dev/null; then
    echo "错误：未检测到 Node.js。请先安装 Node.js 24 LTS（至少 22）：https://nodejs.org/"
    echo "Error: Node.js not found. Install Node.js 24 LTS (22 or newer): https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "错误：Node.js 版本太旧（当前 $(node -v)），需要 22 或以上（建议 24 LTS）"
    echo "Error: Node.js $(node -v) is too old. Version 22 or newer is needed (24 LTS recommended)."
    exit 1
fi
echo "✓ Node.js $(node -v)"

cd "$(dirname "$0")"

echo ""
echo "[1/4] 安装依赖（按 package-lock.json 的确切版本）/ Installing the exact locked dependencies..."
npm ci

echo ""
echo "[2/4] 生成 Prisma Client / Generating the Prisma client..."
npx prisma generate

echo ""
echo "[3/4] 登录密钥和数据库 / Login secret and database..."
node scripts/source-run.js setup

echo ""
echo "[4/4] 编译正式版（需要几分钟）/ Building the production version (a few minutes)..."
node scripts/source-run.js build

echo ""
echo "=========================================="
echo "  安装完成！ / Installed."
echo "=========================================="
echo "  启动 / Start:  ./start.sh"
echo "  打开 / Open:   http://localhost:3000"
echo ""
echo "  第一次打开时设置老板账号，需要输入 start.sh 窗口里显示的一次性设置码。"
echo "  On the first visit, create the boss account with the one-time setup code shown in the start.sh window."
echo ""
echo "  默认只有这台电脑能打开。员工手机 / 平板（只在员工专用 Wi-Fi 上）：在 .env.local 加一行 WORKSHOP_LAN=1。"
echo "  Only this computer can open it. For staff phones / tablets on a staff-only Wi-Fi, add WORKSHOP_LAN=1 to .env.local."
echo ""
echo "  登录密钥保存在 .env.local（请勿分享、勿上传）。/ The login secret is in .env.local (keep it private)."
echo "=========================================="
