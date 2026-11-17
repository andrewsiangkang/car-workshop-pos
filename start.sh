#!/bin/bash
# 启动修车店 POS 系统（正式模式，默认只限本机）/ Start Workshop POS (production, this computer only)
# Phone / tablet access: add WORKSHOP_LAN=1 to .env.local (staff-only Wi-Fi only).
cd "$(dirname "$0")"
echo "正在启动修车店 POS 系统（正式模式）... / Starting Workshop POS (production)..."
echo "打开浏览器访问 / Open: http://localhost:3000"
echo "按 Ctrl+C 停止 / Press Ctrl+C to stop"
exec node scripts/source-run.js start
