@echo off
setlocal enabledelayedexpansion

echo ===============================================
echo  SmartLife Final-Project - Sync latest work
echo ===============================================
echo.

REM Make sure we're inside a git repo
if not exist ".git" (
    echo ERROR: This folder is not a git repository.
    echo Please put this .cmd file inside your Final-Project folder and run it from there.
    pause
    exit /b 1
)

echo Current git status:
git status
echo.

REM Check for uncommitted changes (working tree)
git diff --quiet
if errorlevel 1 (
    echo WARNING: You have uncommitted changes in your working folder.
    echo Please commit or stash them first, then run this script again.
    echo Nothing has been changed. Exiting safely.
    pause
    exit /b 1
)

REM Check for staged-but-uncommitted changes
git diff --cached --quiet
if errorlevel 1 (
    echo WARNING: You have staged but uncommitted changes.
    echo Please commit or stash them first, then run this script again.
    echo Nothing has been changed. Exiting safely.
    pause
    exit /b 1
)

echo Your working tree is clean. Continuing...
echo.

echo Current remotes:
git remote -v
echo.

REM Add the remote pointing at the shared project, without touching existing remotes
git remote get-url faloxsgz5 >nul 2>&1
if errorlevel 1 (
    echo Adding remote 'faloxsgz5' -> https://github.com/faloxsgz5-oss/Final-Project.git
    git remote add faloxsgz5 https://github.com/faloxsgz5-oss/Final-Project.git
) else (
    echo Remote 'faloxsgz5' already exists, skipping add.
)
echo.

echo Fetching latest work from faloxsgz5...
git fetch faloxsgz5
if errorlevel 1 (
    echo ERROR: fetch failed. Check your internet connection or that you have
    echo access to the repository, then try again.
    pause
    exit /b 1
)
echo.

REM Create the local branch if it doesn't exist yet, otherwise switch + pull
git rev-parse --verify merge-kim-ui-calendar-line-20260813 >nul 2>&1
if errorlevel 1 (
    echo Creating local branch from faloxsgz5/merge-kim-ui-calendar-line-20260813 ...
    git checkout -b merge-kim-ui-calendar-line-20260813 faloxsgz5/merge-kim-ui-calendar-line-20260813
) else (
    echo Branch already exists locally. Switching to it and pulling the latest...
    git checkout merge-kim-ui-calendar-line-20260813
    git pull faloxsgz5 merge-kim-ui-calendar-line-20260813
)
echo.

echo Installing/updating dependencies (npm install)...
call npm install
echo.

echo ===============================================
echo  Done!
echo  - Confirm .env.local still exists in this folder
echo    with real values (it was not touched by this script).
echo  - Then run:  npm start
echo    (or:       npx expo start)
echo ===============================================
pause
