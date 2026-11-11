@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动修车店 POS 系统...
echo 打开浏览器访问: http://localhost:3000
echo 按 Ctrl+C 停止
npm run dev
pause
