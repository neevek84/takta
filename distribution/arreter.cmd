@echo off
rem Arrete l'application CRA. Voir LISEZMOI.txt
setlocal

set "RACINE=%~dp0"
if "%RACINE:~-1%"=="\" set "RACINE=%RACINE:~0,-1%"
set "CRA_RACINE=%RACINE%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur cet ordinateur.
  echo   Installe Node.js 20 ou plus depuis https://nodejs.org
  echo   puis relance arreter.cmd
  echo.
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set "MAJEURE=%%v"
set "MAJEURE=%MAJEURE:v=%"

echo %MAJEURE%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo.
  echo   Impossible de lire la version de Node.js.
  echo   Reinstalle Node.js 20 ou plus depuis https://nodejs.org
  echo.
  exit /b 1
)

if %MAJEURE% LSS 20 (
  echo.
  echo   Node.js version %MAJEURE% est trop ancien : il faut la version 20 ou plus.
  echo   Installe une version recente depuis https://nodejs.org
  echo   puis relance arreter.cmd
  echo.
  exit /b 1
)

node "%RACINE%\app\outils\arreter.mjs" %*
exit /b %errorlevel%
