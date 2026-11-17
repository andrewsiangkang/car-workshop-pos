@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动修车店 POS 系统（正式模式）... / Starting Workshop POS (production)...
echo 打开浏览器访问 / Open: http://localhost:3000
echo 按 Ctrl+C 停止 / Press Ctrl+C to stop
node scripts\source-run.js start
pause
