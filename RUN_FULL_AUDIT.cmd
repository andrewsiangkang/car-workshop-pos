@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "audit-results" mkdir "audit-results"
set "LOG=audit-results\full-audit.log"
echo Car Workshop POS v0.5.12 Full Audit > "%LOG%"
echo Started: %DATE% %TIME% >> "%LOG%"
echo [1/7] Check Node and npm...
node --version >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_node
npm --version >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_node
echo [2/7] Install locked dependencies...
call npm ci --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_install
echo [3/7] Generate Prisma Client...
call npx prisma generate >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_prisma
echo [4/7] TypeScript...
call npm run typecheck >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_type
echo [5/7] ESLint...
call npm run lint >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_lint
echo [6/7] Automated tests...
call npm test >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_test
echo [7/7] Production build...
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_build
echo RESULT: ALL CHECKS PASSED >> "%LOG%"
echo ALL CHECKS PASSED. Log: %LOG%
pause
exit /b 0
:fail_node
echo FAILED: Node.js/npm missing. >> "%LOG%"
goto :failed
:fail_install
echo FAILED: npm ci. Check internet/proxy/npm registry. >> "%LOG%"
goto :failed
:fail_prisma
echo FAILED: Prisma generate. >> "%LOG%"
goto :failed
:fail_type
echo FAILED: TypeScript typecheck. >> "%LOG%"
goto :failed
:fail_lint
echo FAILED: ESLint. >> "%LOG%"
goto :failed
:fail_test
echo FAILED: Automated tests. >> "%LOG%"
goto :failed
:fail_build
echo FAILED: Production build. >> "%LOG%"
goto :failed
:failed
echo AUDIT STOPPED. See %LOG%
echo Do not create a release tag until all checks pass.
pause
exit /b 1
