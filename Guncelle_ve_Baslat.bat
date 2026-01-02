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
    echo [!] Git bulunamadi, guncelleme atlaniyor...
    goto :START_APP
)

echo [1/3] Guncellemeler kontrol ediliyor...
git fetch --quiet origin main >nul 2>nul

:: Versiyon kontrolu
for /f "tokens=*" %%a in ('git rev-parse HEAD') do set LOCAL_REV=%%a
for /f "tokens=*" %%a in ('git rev-parse origin/main') do set REMOTE_REV=%%a

if "%LOCAL_REV%" neq "%REMOTE_REV%" (
    echo [!] Yeni guncelleme bulundu! Kodlar yenileniyor...
    git reset --hard origin/main
    git clean -fd
    
    echo [2/3] Paketler guncelleniyor...
    call npm install
) else (
    :: Versiyonlar ayni olsa bile dosya eksikligini veya degisikligini kontrol et
    git status --porcelain | findstr /v "data" | findstr /R "^" >nul
    if %errorlevel% equ 0 (
        echo [!] Yerel dosyalar eksik veya degismis. Repo ile esitleniyor...
        git reset --hard origin/main
        git clean -fd
    ) else (
        echo [OK] Yazilim guncel ve tam.
    )
)

:START_APP
if not exist "node_modules\" (
    echo [!] Paketler eksik, yukleniyor...
    call npm install
)

echo.
echo [3/3] Telegram Macro Automation baslatiliyor...
echo.

:: npm start kullanıyoruz (package.json içinde --dev sildik)
:: 'call' kullanmıyoruz ki batch dosyası kendini bu işleme devretsin, fazladan pencere kalmasın
npm start

if %errorlevel% neq 0 (
    echo.
    echo [HATA] Uygulama baslatilamadi.
    pause
)
