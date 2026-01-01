@echo off
title Telegram Macro Update & Start
setlocal enabledelayedexpansion

echo.
echo ===========================================
echo    TELEGRAM MACRO OTOMATIK GUNCELLEME
echo ===========================================
echo.

:: Git yuklu mu kontrol et
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] HATA: Git sistemde bulunamadi. Guncellemeler kontrol edilemiyor.
    echo [!] Lutfen Git'i yukleyin: https://git-scm.com/
    goto :START_APP
)

echo [1/3] Guncellemeler kontrol ediliyor...
git fetch --quiet origin main >nul 2>nul

:: Yerel ve uzak dallari karsilastir
for /f "tokens=*" %%a in ('git rev-parse HEAD') do set LOCAL_REV=%%a
for /f "tokens=*" %%a in ('git rev-parse origin/main') do set REMOTE_REV=%%a

if "%LOCAL_REV%" neq "%REMOTE_REV%" (
    echo [!] Yeni guncelleme bulundu!
    echo [!] Kodlar indiriliyor...
    
    :: Yerel degisiklikleri temizle ve cek (data klasoru gitignore'da oldugu icin guvenlidir)
    git reset --hard origin/main
    
    echo [2/3] NPM paketleri guncelleniyor (bu biraz zaman alabilir)...
    call npm install
    echo [OK] Guncelleme tamamlandi.
) else (
    echo [OK] Yazilim guncel.
)

:START_APP
:: node_modules yoksa yukle
if not exist "node_modules\" (
    echo [!] node_modules bulunamadi, paketler yukleniyor...
    call npm install
)

echo.
echo [3/3] Telegram Macro Automation baslatiliyor...
echo.

:: start-dev.bat calistigi icin burayi da dev moduna cekiyoruz
call npm run dev

if %errorlevel% neq 0 (
    echo.
    echo [!] Uygulama bir hata ile karsilasti veya kapandi.
    echo [!] Hata kodu: %errorlevel%
    pause
)
