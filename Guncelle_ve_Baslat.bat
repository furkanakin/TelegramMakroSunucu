@echo off
title Telegram Macro Update & Start

echo.
echo ===========================================
echo    TELEGRAM MACRO OTOMATIK GUNCELLEME
echo ===========================================
echo.

:: Git kontrolu
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [HATA] Git sistemde bulunamadi. Guncellemeler kontrol edilemiyor.
    goto :START_APP
)

echo [1/3] Guncellemeler kontrol ediliyor...
git fetch --quiet origin main >nul 2>nul

:: Versiyonlari al
for /f "tokens=*" %%a in ('git rev-parse HEAD') do set LOCAL_REV=%%a
for /f "tokens=*" %%a in ('git rev-parse origin/main') do set REMOTE_REV=%%a

if "%LOCAL_REV%" neq "%REMOTE_REV%" (
    echo [YENI] Guncelleme bulundu! Kodlar indiriliyor...
    git reset --hard origin/main
    
    echo [2/3] Paketler guncelleniyor...
    call npm install
) else (
    echo [OK] Yazilim guncel.
)

:START_APP
:: node_modules check
if not exist "node_modules\" (
    echo [!] Paketler eksik, yukleniyor...
    call npm install
)

echo.
echo [3/3] Telegram Macro Automation baslatiliyor...
echo.

call npm run dev

if %errorlevel% neq 0 (
    echo.
    echo [HATA] Uygulama kapandi veya baslatilamadi.
    echo Hata Kodu: %errorlevel%
    pause
)
