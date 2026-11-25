@echo off
rem Build audiolab-recorder for Windows into ..\bin\win32-x64\.
rem Run from a Visual Studio "Developer Command Prompt" (provides cl.exe).
setlocal
cd /d "%~dp0"
if not exist "..\bin\win32-x64" mkdir "..\bin\win32-x64"
cl /nologo /O2 recorder.c /Fe:"..\bin\win32-x64\audiolab-recorder.exe" ole32.lib
if errorlevel 1 exit /b 1
del /q audiolab-recorder.obj 2>nul
echo built ..\bin\win32-x64\audiolab-recorder.exe
where node >nul 2>nul
if %errorlevel%==0 (
  node pack.mjs
) else (
  echo node not found - run "node pack.mjs" here to refresh ..\bin\audiolab-recorder-all
)
