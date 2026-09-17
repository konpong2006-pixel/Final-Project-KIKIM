@echo off
setlocal
cd /d "%~dp0"

echo ===============================================
echo   กำลังอัปเดตเว็บไซต์ SmartLife...
echo   (build เว็บแล้ว deploy ขึ้น smartlife-budget.web.app)
echo ===============================================
echo.

call npm run deploy:web

echo.
if %ERRORLEVEL% NEQ 0 (
  echo ทำไม่สำเร็จ กรุณาอ่านข้อความด้านบนว่าติดตรงไหน
) else (
  echo เสร็จแล้ว! เปิดดูได้ที่ https://smartlife-budget.web.app
)
echo.
pause
