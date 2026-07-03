@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   Subiendo Disensa-prioridad a GitHub
echo ================================================
echo.

REM Quita el candado de git si quedo de una operacion previa
if exist ".git\index.lock" del /f /q ".git\index.lock"

REM Confirma identidad de git (solo si no esta configurada)
for /f "delims=" %%i in ('git config user.email 2^>nul') do set GITMAIL=%%i
if "%GITMAIL%"=="" git config user.email "joelobr123@gmail.com"
for /f "delims=" %%i in ('git config user.name 2^>nul') do set GITNAME=%%i
if "%GITNAME%"=="" git config user.name "Joel Obregon"

echo Agregando cambios...
git add -A

echo Creando commit...
git commit -m "Actualizacion: nota de credito, modulo reposicion, alertas de falta = reposiciones, suministrador solo reposicion, nivel de alerta por tramo del semaforo"

echo Subiendo a GitHub (rama main)...
git push origin main

echo.
echo ================================================
echo   Listo. Revisa: https://github.com/Joel-Obregon/disensa-prioridad
echo ================================================
pause
