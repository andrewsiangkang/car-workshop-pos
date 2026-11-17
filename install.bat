@echo off
chcp 65001 >nul
setlocal
echo ==========================================
echo   修车店 POS 系统 - 源码版安装 / Source install
echo ==========================================
echo   一般店铺请直接用 Windows 安装程序（WorkshopPOS-Setup-x.y.z.exe）。
echo   Most shops should use the Windows installer instead.
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo 错误：未检测到 Node.js。请先安装 Node.js 24 LTS（至少 22）：https://nodejs.org/
    echo Error: Node.js not found. Install Node.js 24 LTS ^(22 or newer^): https://nodejs.org/
    pause
    exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if %errorlevel% neq 0 (
    echo 错误：Node.js 版本太旧，需要 22 或以上（建议 24 LTS）。
    echo Error: Node.js is too old. Version 22 or newer is needed ^(24 LTS recommended^).
    node -v
    pause
    exit /b 1
)
echo ✓ Node.js
node -v
echo.

cd /d "%~dp0"

echo [1/4] 安装依赖（按 package-lock.json 的确切版本）/ Installing the exact locked dependencies...
call npm ci
if %errorlevel% neq 0 (
    echo 安装依赖失败 / npm ci failed
    pause
    exit /b 1
)

echo.
echo [2/4] 生成 Prisma Client / Generating the Prisma client...
call npx prisma generate
if %errorlevel% neq 0 (
    echo Prisma generate 失败 / failed
    pause
    exit /b 1
)

echo.
echo [3/4] 登录密钥和数据库 / Login secret and database...
node scripts\source-run.js setup
if %errorlevel% neq 0 (
    echo 初始化失败 / Setup failed
    pause
    exit /b 1
)

echo.
echo [4/4] 编译正式版（需要几分钟）/ Building the production version (a few minutes)...
node scripts\source-run.js build
if %errorlevel% neq 0 (
    echo 编译失败 / Build failed
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   安装完成！ / Installed.
echo ==========================================
echo   启动 / Start:  双击 start.bat  (double-click start.bat)
echo   打开 / Open:   http://localhost:3000
echo.
echo   第一次打开时设置老板账号，需要输入 start.bat 窗口里显示的一次性设置码。
echo   On the first visit, create the boss account with the one-time setup code shown in the start.bat window.
echo.
echo   默认只有这台电脑能打开。员工手机 / 平板（只在员工专用 Wi-Fi 上）：在 .env.local 加一行 WORKSHOP_LAN=1。
echo   Only this computer can open it. For staff phones / tablets on a staff-only Wi-Fi, add the line WORKSHOP_LAN=1 to .env.local.
echo.
echo   登录密钥保存在 .env.local（请勿分享、勿上传）。/ The login secret is in .env.local (keep it private).
echo ==========================================
pause
