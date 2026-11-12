@echo off
chcp 65001 >nul
echo ==========================================
echo   修车店 POS 系统 - 安装程序
echo ==========================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo 错误：未检测到 Node.js
    echo 请先安装 Node.js 18 或以上版本：
    echo   https://nodejs.org/
    pause
    exit /b 1
)

echo ✓ Node.js 已安装
echo.

cd /d "%~dp0"

echo 正在安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo 安装依赖失败
    pause
    exit /b 1
)

echo.
echo 正在生成 Prisma Client...
call npx prisma generate
if %errorlevel% neq 0 (
    echo Prisma generate 失败
    pause
    exit /b 1
)

echo.
echo 正在初始化数据库（空白）...
call npx prisma db push
if %errorlevel% neq 0 (
    echo 数据库初始化失败
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   安装完成！
echo ==========================================
echo.
echo 启动系统：
echo   npm run dev
echo.
echo 然后打开浏览器访问：
echo   http://localhost:3000
echo.
echo 第一次打开会要求你设置用户名和密码。
echo 数据库从空白开始，没有任何预置资料。
echo.
echo 停止系统：按 Ctrl + C
echo ==========================================
pause
