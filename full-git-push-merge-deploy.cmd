@echo off
setlocal enabledelayedexpansion

title SmartLife - Push everything to GitHub + merge to master + deploy rules

REM ============================================================
REM  Make sure we're inside the project folder
REM ============================================================
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [ERROR] This file must be placed and run INSIDE the project folder
  echo   ^(the one that contains firestore.rules and package.json^),
  echo   e.g. C:\Users\HP\Documents\Project end\SmartLifeExpo
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "CURRENT_BRANCH=%%B"

echo.
echo ==========================================
echo   Step 1: Commit + push everything on
echo   your current branch ^(!CURRENT_BRANCH!^)
echo ==========================================
echo.

echo [INFO] Current status:
echo.
git status
echo.

git diff --quiet
set "DIFF1=%errorlevel%"
git diff --cached --quiet
set "DIFF2=%errorlevel%"
for /f %%N in ('git ls-files --others --exclude-standard ^| find /c /v ""') do set "UNTRACKED=%%N"

if "%DIFF1%%DIFF2%"=="00" if "%UNTRACKED%"=="0" (
  echo [INFO] Nothing uncommitted - already clean. Skipping commit.
  goto :push_current_branch
)

echo [INFO] Quick scan for anything that looks like a secret/key...
git diff > "%TEMP%\smartlife_diff_scan.txt" 2>nul
git diff --cached >> "%TEMP%\smartlife_diff_scan.txt" 2>nul
findstr /C:"AIzaSy" /C:"-----BEGIN" /C:"sk-ant-" /C:"sk-proj-" /C:"sk-live-" /C:"AKIA" "%TEMP%\smartlife_diff_scan.txt" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [WARNING] Something that LOOKS like an API key or secret was found in
  echo your uncommitted changes. This is a simple text scan, not a guarantee -
  echo check the matches below by hand before continuing:
  echo.
  findstr /N /C:"AIzaSy" /C:"-----BEGIN" /C:"sk-ant-" /C:"sk-proj-" /C:"sk-live-" /C:"AKIA" "%TEMP%\smartlife_diff_scan.txt"
  echo.
  echo Press Ctrl+C now to stop and review manually, or press any key to
  echo continue anyway if you've already checked it.
  pause
)
del "%TEMP%\smartlife_diff_scan.txt" >nul 2>nul

echo.
set /p CONFIRM0=Commit everything shown above onto branch "!CURRENT_BRANCH!"? (y/n):
if /I not "%CONFIRM0%"=="y" (
  echo.
  echo [INFO] Stopped. Nothing was committed or pushed.
  pause
  exit /b 0
)

git add -A
git commit -m "Update SmartLife: burnout/sleep-log feature, tests, presentation assets" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_016RKgpGMv3gsMfJqYW42ten"
if errorlevel 1 (
  echo.
  echo [ERROR] Commit failed. Stopping here.
  pause
  exit /b 1
)

:push_current_branch
echo.
echo [INFO] Pushing !CURRENT_BRANCH! to origin...
git push -u origin !CURRENT_BRANCH!
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Check your git login/permissions, then try:
  echo   git push -u origin !CURRENT_BRANCH!
  pause
  exit /b 1
)
echo [OK] !CURRENT_BRANCH! is committed and pushed.

REM ============================================================
REM  Step 2: merge into master (skip if we're already on master)
REM ============================================================
if /I "!CURRENT_BRANCH!"=="master" (
  echo.
  echo [INFO] You're already on master - nothing to merge.
  goto :deploy_rules
)

echo.
echo ==========================================
echo   Step 2: Merge !CURRENT_BRANCH! into master
echo ==========================================
echo.

echo [INFO] Fetching latest from origin...
git fetch origin
if errorlevel 1 (
  echo [ERROR] git fetch failed.
  pause
  exit /b 1
)

echo [INFO] Switching to master...
git checkout master
if errorlevel 1 (
  echo [ERROR] Could not switch to master.
  pause
  exit /b 1
)

echo [INFO] Pulling latest master...
git pull origin master
if errorlevel 1 (
  echo [ERROR] git pull failed.
  pause
  exit /b 1
)

echo.
echo [INFO] Commits that will be added to master:
echo.
git log master..!CURRENT_BRANCH! --oneline
echo.
set /p CONFIRM1=Merge these into master and push? (y/n):
if /I not "%CONFIRM1%"=="y" (
  echo.
  echo [INFO] Stopped. master was not changed. Your work is still safely
  echo pushed on branch !CURRENT_BRANCH! though.
  pause
  exit /b 0
)

git merge --no-ff !CURRENT_BRANCH! -m "Merge !CURRENT_BRANCH! into master" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_016RKgpGMv3gsMfJqYW42ten"
if errorlevel 1 (
  echo.
  echo [ERROR] Merge conflict or failure. This script will NOT try to resolve
  echo it automatically. Check:
  echo   git status
  echo Fix conflicts by hand, then:
  echo   git add ^<files^>
  echo   git commit
  echo Or cancel the merge entirely with:
  echo   git merge --abort
  echo.
  echo Tip: if there's a conflict, it's safer to paste this situation into
  echo Claude Code and let it resolve conflicts thoughtfully rather than
  echo guessing by hand.
  pause
  exit /b 1
)

echo.
echo [INFO] Pushing master...
git push origin master
if errorlevel 1 (
  echo [ERROR] Push failed. Check your git login/permissions, then try:
  echo   git push origin master
  pause
  exit /b 1
)

echo.
echo [OK] master is now up to date and pushed.

REM ============================================================
REM  Step 3: deploy firestore.rules to Firebase
REM ============================================================
:deploy_rules
echo.
echo ==========================================
echo   Step 3: Deploy firestore.rules to Firebase
echo ==========================================
echo.
echo [INFO] Current firestore.rules content:
echo.
type firestore.rules
echo.
echo [WARNING] This will deploy the rules shown above to your LIVE Firebase
echo project. Read through the settings/sleepBaseline rules one more time
echo before continuing.
echo.
set /p CONFIRM2=Deploy firestore.rules to production now? (y/n):
if /I not "%CONFIRM2%"=="y" (
  echo.
  echo [INFO] Skipped. Rules were NOT deployed. Everything else above
  echo ^(commit, push, master merge^) already happened though.
  pause
  exit /b 0
)

where firebase >nul 2>nul
if errorlevel 1 (
  echo [ERROR] firebase CLI not found on PATH. Either install it, or run:
  echo   npx firebase-tools deploy --only firestore:rules
  pause
  exit /b 1
)

firebase deploy --only firestore:rules
if errorlevel 1 (
  echo.
  echo [ERROR] Deploy failed. Check the error above - common causes:
  echo   - not logged in: run "firebase login"
  echo   - wrong project selected: check .firebaserc
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   All done: committed, pushed, merged to
echo   master, and Firestore rules deployed.
echo ==========================================
echo.
pause
