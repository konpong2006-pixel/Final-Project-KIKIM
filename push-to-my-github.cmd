@echo off
setlocal enabledelayedexpansion

title SmartLife - Push current branch to MY OWN GitHub (personal)

REM ============================================================
REM  Pushes the CURRENT branch to the "personal" remote only.
REM
REM  Safety rules baked in:
REM    - never pushes to origin / faloxsgz5 / natgamol (friend's repos)
REM    - never pushes to master or main
REM    - never force-pushes
REM    - never merges, never deploys
REM    - never runs "git add ."  (only stages already-tracked files)
REM ============================================================

echo.
echo ============================================================
echo   SmartLife - push to YOUR repo (personal remote)
echo ============================================================
echo.

REM ---------- must be inside the repo ----------
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Not inside a git repository.
  echo         Put this file in the project folder and run it there.
  echo.
  pause
  exit /b 1
)

REM ---------- which branch ----------
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
if not defined BRANCH (
  echo [ERROR] Could not read the current branch.
  pause
  exit /b 1
)

if /i "!BRANCH!"=="master" goto :protected_branch
if /i "!BRANCH!"=="main"   goto :protected_branch
if /i "!BRANCH!"=="HEAD" (
  echo [ERROR] Detached HEAD - you are not on a branch.
  echo         Switch to a branch first:  git switch -c my-work
  pause
  exit /b 1
)
goto :branch_ok

:protected_branch
echo [STOP] You are on "!BRANCH!".
echo        This script refuses to push master/main to avoid
echo        overwriting shared work. Make your own branch first:
echo.
echo          git switch -c codex/my-changes
echo.
pause
exit /b 1

:branch_ok

REM ---------- the personal remote must exist and must be yours ----------
set "TARGET=personal"
set "REMOTE_URL="
for /f "delims=" %%U in ('git remote get-url !TARGET! 2^>nul') do set "REMOTE_URL=%%U"

if not defined REMOTE_URL (
  echo [ERROR] Remote "!TARGET!" does not exist.
  echo         Add your own repo first:
  echo.
  echo           git remote add personal https://github.com/konpong2006-pixel/Final-Project-KIKIM.git
  echo.
  pause
  exit /b 1
)

echo !REMOTE_URL! | findstr /i "faloxsgz5 natgamol" >nul
if not errorlevel 1 (
  echo [STOP] Remote "!TARGET!" points at someone else's repo:
  echo          !REMOTE_URL!
  echo        Refusing to push. Fix the remote before running this again.
  echo.
  pause
  exit /b 1
)

echo   Branch : !BRANCH!
echo   Target : !TARGET!  ^-^>  !REMOTE_URL!
echo.

REM ---------- what has changed ----------
echo ------------------------------------------------------------
echo   Current status
echo ------------------------------------------------------------
git status --short
echo.

REM ---------- stage tracked changes only ----------
echo [INFO] Staging changes to files git already tracks.
echo        New/untracked files are NOT added automatically -
echo        this folder holds APKs, screenshots and private data.
echo.
git add -u
if errorlevel 1 (
  echo [ERROR] git add -u failed.
  pause
  exit /b 1
)

REM ---------- offer to add specific new files ----------
echo ------------------------------------------------------------
echo   Untracked files (NOT staged)
echo ------------------------------------------------------------
git ls-files --others --exclude-standard
echo.
echo If you want any of those included, type the exact path.
echo Leave blank and press Enter to skip.
echo.
set "EXTRA="
set /p "EXTRA=File to add (blank = none): "
if defined EXTRA (
  git add -- "!EXTRA!"
  if errorlevel 1 (
    echo [WARN] Could not add "!EXTRA!" - continuing without it.
  ) else (
    echo [OK] Added "!EXTRA!"
  )
)
echo.

REM ---------- anything staged at all? ----------
git diff --cached --quiet
if not errorlevel 1 (
  echo [INFO] Nothing staged to commit.
  echo        Pushing existing commits only.
  goto :do_push
)

REM ---------- what is about to be committed ----------
echo ------------------------------------------------------------
echo   Files about to be committed
echo ------------------------------------------------------------
git diff --cached --name-only
echo.

REM ---------- secret scan ----------
set "SCAN=%TEMP%\smartlife_push_scan.txt"
git diff --cached > "!SCAN!" 2>nul
findstr /C:"AIzaSy" /C:"-----BEGIN" /C:"sk-ant-" /C:"sk-proj-" /C:"AKIA" /C:"FIREBASE_APP_CHECK_DEBUG_TOKEN=4" "!SCAN!" >nul 2>nul
if not errorlevel 1 (
  echo [WARNING] Something that looks like a key, secret or debug token
  echo           appears in the staged changes.
  echo.
  set "SEC="
  set /p "SEC=Continue anyway? (yes/no): "
  if /i not "!SEC!"=="yes" (
    echo [STOP] Cancelled. Nothing was committed or pushed.
    del "!SCAN!" >nul 2>nul
    pause
    exit /b 1
  )
)
del "!SCAN!" >nul 2>nul

REM ---------- warn about the local-only QA notes ----------
git diff --cached --name-only | findstr /i "LOCAL-APPCHECK-QA" >nul 2>nul
if not errorlevel 1 (
  echo [WARNING] LOCAL-APPCHECK-QA notes are staged. That file contains an
  echo           App Check debug token and is meant to stay on your machine.
  echo.
  set "QA="
  set /p "QA=Include it anyway? (yes/no): "
  if /i not "!QA!"=="yes" (
    git restore --staged "docs/LOCAL-APPCHECK-QA-2026-09-14.md" >nul 2>nul
    echo [OK] Unstaged. It will not be pushed.
    echo.
  )
)

REM ---------- commit ----------
echo ------------------------------------------------------------
set "MSG="
set /p "MSG=Commit message: "
if not defined MSG (
  echo [STOP] Empty message. Nothing was committed or pushed.
  pause
  exit /b 1
)

git commit -m "!MSG!"
if errorlevel 1 (
  echo [ERROR] Commit failed. Nothing was pushed.
  pause
  exit /b 1
)
echo.

:do_push
echo ------------------------------------------------------------
echo   Ready to push
echo ------------------------------------------------------------
echo     !BRANCH!  ^-^>  !TARGET!
echo     !REMOTE_URL!
echo.
set "GO="
set /p "GO=Push now? (yes/no): "
if /i not "!GO!"=="yes" (
  echo [STOP] Not pushed. Your commit is saved locally.
  echo        Push later with:  git push -u !TARGET! "!BRANCH!"
  pause
  exit /b 0
)

echo.
git push -u !TARGET! "!BRANCH!"
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Common causes:
  echo   - not logged in to GitHub
  echo   - the remote has commits you do not have yet
  echo.
  echo If the remote is ahead, pull first - do NOT use --force:
  echo   git pull --rebase !TARGET! "!BRANCH!"
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Done. Pushed "!BRANCH!" to your own repo.
echo.
echo   Nothing was merged, nothing was deployed, and your
echo   friend's repo was not touched.
echo ============================================================
echo.
pause
exit /b 0
