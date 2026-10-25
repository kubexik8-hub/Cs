@echo off
chcp 65001 >nul
title CS2 OBS Widget - Leetify Local
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo BLAD: Nie znaleziono Node.js.
  echo Zainstaluj Node.js w wersji 20 lub nowszej.
  pause
  exit /b 1
)

if not exist "config.json" (
  copy "config.example.json" "config.json" >nul
  echo Utworzono config.json z szablonu.
  echo Uzupelnij steamId i opcjonalnie leetifyApiKey, a potem uruchom ponownie.
  notepad "config.json"
  pause
  exit /b 0
)

node server.js
echo.
echo Serwer lokalny zostal zamkniety.
pause
