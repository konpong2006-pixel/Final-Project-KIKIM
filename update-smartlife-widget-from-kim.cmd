@echo off
setlocal

title SmartLife Widget Update from KIM

set "KIM_REMOTE_NAME=kim"
set "KIM_REMOTE_URL=https://github.com/konpong2006-pixel/Final-Project-KIKIM.git"
set "KIM_WIDGET_BRANCH=codex/android-widget-update"
set "KIM_WIDGET_COMMIT=b6a27a4"

echo.
echo ==========================================
echo   SmartLife Android Widget Update
echo ==========================================
echo.

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Please run this file inside the Final-Project folder.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%S in ('git status --porcelain') do (
  echo [ERROR] Your working tree has uncommitted changes.
  echo Please commit, stash, or backup your changes before updating.
  echo.
  git status --short
  echo.
  pause
  exit /b 1
)

git remote get-url %KIM_REMOTE_NAME% >nul 2>nul
if errorlevel 1 (
  echo [INFO] Adding remote %KIM_REMOTE_NAME%...
  git remote add %KIM_REMOTE_NAME% %KIM_REMOTE_URL%
) else (
  echo [INFO] Updating remote %KIM_REMOTE_NAME% URL...
  git remote set-url %KIM_REMOTE_NAME% %KIM_REMOTE_URL%
)

echo.
echo [INFO] Fetching widget update branch...
git fetch %KIM_REMOTE_NAME% %KIM_WIDGET_BRANCH%
if errorlevel 1 (
  echo.
  echo [ERROR] Cannot fetch %KIM_WIDGET_BRANCH% from:
  echo %KIM_REMOTE_URL%
  echo.
  echo Please check that the branch was pushed and this GitHub repo is accessible.
  echo.
  pause
  exit /b 1
)

echo.
echo [INFO] Applying widget commit %KIM_WIDGET_COMMIT%...
git cherry-pick %KIM_WIDGET_COMMIT%
if errorlevel 1 (
  echo.
  echo [ERROR] Cherry-pick failed, probably because of a code conflict.
  echo Resolve the conflict, then run:
  echo   git cherry-pick --continue
  echo.
  echo To cancel this update, run:
  echo   git cherry-pick --abort
  echo.
  pause
  exit /b 1
)

echo.
echo [INFO] Installing/updating dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

if exist functions\package.json (
  echo.
  echo [INFO] Installing/updating Firebase Functions dependencies...
  call npm --prefix functions install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm --prefix functions install failed.
    pause
    exit /b 1
  )
)

echo.
echo ==========================================
echo   Widget update completed successfully.
echo ==========================================
echo.
echo Next commands:
echo   npm start
echo.
echo To build APK:
echo   cd android
echo   gradlew.bat assembleRelease
echo.
pause
