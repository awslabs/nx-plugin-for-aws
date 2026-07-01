@echo off
REM Forwards docker commands from Windows to the WSL2 Linux Docker daemon.
REM For "docker build", uses the linux-builder (Buildx docker-container driver)
REM and adds --load unless --output is already specified (they conflict).
REM The target distro is taken from WSL_DOCKER_DISTRO (set by init-monorepo),
REM defaulting to Ubuntu-24.04.

if "%WSL_DOCKER_DISTRO%"=="" set WSL_DOCKER_DISTRO=Ubuntu-24.04

for /f "usebackq tokens=*" %%i in (`wsl -d %WSL_DOCKER_DISTRO% wslpath "%CD%"`) do set WSL_CWD=%%i

if "%1"=="build" (
  echo %* | findstr /i /c:"--output" >nul
  if errorlevel 1 (
    wsl -d %WSL_DOCKER_DISTRO% -u root --cd "%WSL_CWD%" -- env BUILDX_BUILDER=linux-builder docker %* --load
  ) else (
    wsl -d %WSL_DOCKER_DISTRO% -u root --cd "%WSL_CWD%" -- env BUILDX_BUILDER=linux-builder docker %*
  )
) else (
  wsl -d %WSL_DOCKER_DISTRO% -u root --cd "%WSL_CWD%" -- docker %*
)
