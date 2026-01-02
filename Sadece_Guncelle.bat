@echo off
title Telegram Macro Sadece Guncelle
cd /d %~dp0

:: Git kontrolu
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [HATA] Git sisteminizde kurulu degil!
    echo Otomatik guncelleme icin Git gereklidir.
    echo Lutfen indirin ve kurun: https://git-scm.com/download/win
    echo.
    pause
    exit /b
)

echo [1/2] Guncellemeler kontrol ediliyor...
git fetch origin main
git reset --hard origin/main
git clean -fd
echo.
echo Mevcut Versiyon:
git log -1 --pretty=format:"%%h - %%s (%%cr)"
echo.
echo [2/2] NPM paketleri guncelleniyor...
call npm install
echo.
echo ===========================================
echo    GUNCELLEME TAMAMLANDI
echo ===========================================
echo.
pause
