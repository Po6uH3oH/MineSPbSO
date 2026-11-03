@echo off
setlocal
cd /d "%~dp0"
set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node.exe"
"%NODE%" scripts\start-community.mjs %*
if errorlevel 1 pause
