@echo off
REM ============================================================
REM  Claude Code 2-split launcher (left / right)
REM  Usage: claude-2split.bat [working_directory]
REM ============================================================

setlocal

set "WORKDIR=%~1"
if "%WORKDIR%"=="" set "WORKDIR=%~dp0.."

REM Make sure npm global bin is on PATH (where claude.cmd usually lives)
set "PATH=%APPDATA%\npm;%PATH%"

where wt.exe >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Windows Terminal ^(wt.exe^) not found.
    pause
    exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
    where claude.cmd >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] "claude" command not found in PATH.
        pause
        exit /b 1
    )
)

REM ----- 1x2 equal split (left / right) -----
REM CLAUDE_CODE_NO_FLICKER=1: enables mouse-click cursor positioning, text selection,
REM and click-to-expand tool results inside Claude Code
REM 1) Left pane  (Claude-1)
REM 2) Split vertically (-V) at 50%% -> right pane (Claude-2)
wt -w 0 new-tab -d "%WORKDIR%" --title "Claude-1" cmd /k "set CLAUDE_CODE_NO_FLICKER=1 && claude" ^
  ; split-pane -V -s 0.5 -d "%WORKDIR%" --title "Claude-2" cmd /k "set CLAUDE_CODE_NO_FLICKER=1 && claude"

endlocal
exit /b 0
