@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   Subiendo Disensa-prioridad a GitHub
echo ================================================
echo.

REM Habilita el administrador de credenciales (abre login de GitHub si hace falta)
git config --global credential.helper manager
git config --global credential.helper manager-core

REM Quita el candado de git si quedo de una operacion previa
if exist ".git\index.lock" del /f /q ".git\index.lock"

REM Identidad de git (solo si no esta configurada)
for /f "delims=" %%i in ('git config user.email 2^>nul') do set GITMAIL=%%i
if "%GITMAIL%"=="" git config user.email "joelobr123@gmail.com"
for /f "delims=" %%i in ('git config user.name 2^>nul') do set GITNAME=%%i
if "%GITNAME%"=="" git config user.name "Joel Obregon"

echo Agregando y guardando cambios...
git add -A
git commit -m "Actualizacion Disensa: NC, reposicion, alertas por tramo" 2>nul

echo.
echo Subiendo a GitHub...
echo (Si se abre una ventana de GitHub, inicia sesion. Si pide contrasena,
echo  usa un TOKEN de acceso personal, NO tu contrasena normal.)
echo.
git push origin main

echo.
echo ================================================
echo   Si NO ves errores en rojo, ya se actualizo:
echo   https://github.com/Joel-Obregon/disensa-prioridad
echo ================================================
pause
