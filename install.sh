#!/bin/bash
# 修车店 POS 系统 - 一键安装脚本 (Mac / Linux)
# 使用方法：chmod +x install.sh && ./install.sh

set -e
echo "=========================================="
echo "  修车店 POS 系统 - 安装程序"
echo "=========================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "错误：未检测到 Node.js"
    echo "请先安装 Node.js 18 或以上版本："
    echo "  https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "错误：Node.js 版本过低（当前 $(node -v)），需要 18 或以上"
    exit 1
fi

echo "✓ Node.js $(node -v)"

cd "$(dirname "$0")"

echo ""
echo "正在安装依赖..."
npm install

echo ""
echo "正在生成 Prisma Client..."
npx prisma generate

echo ""
echo "正在初始化数据库（空白）..."
npx prisma db push

echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo ""
echo "启动系统："
echo "  npm run dev"
echo ""
echo "然后打开浏览器访问："
echo "  http://localhost:3000"
echo ""
echo "第一次打开会要求你设置用户名和密码。"
echo "数据库从空白开始，没有任何预置资料。"
echo ""
echo "停止系统：按 Ctrl + C"
echo "=========================================="
