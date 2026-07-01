@echo off
REM Forwards docker commands from Windows to the WSL2 Linux Docker daemon.
REM For "docker build", uses the linux-builder (Buildx docker-container driver)
REM and adds --load unless --output is already specified (they conflict).

for /f "usebackq tokens=*" %%i in (`wsl -d Ubuntu-24.04 wslpath "%CD%"`) do set WSL_CWD=%%i

if "%1"=="build" (
  echo %* | findstr /i /c:"--output" >nul
  if errorlevel 1 (
    wsl -d Ubuntu-24.04 -u root --cd "%WSL_CWD%" -- env BUILDX_BUILDER=linux-builder docker %* --load
  ) else (
    wsl -d Ubuntu-24.04 -u root --cd "%WSL_CWD%" -- env BUILDX_BUILDER=linux-builder docker %*
  )
) else (
  wsl -d Ubuntu-24.04 -u root --cd "%WSL_CWD%" -- docker %*
)
