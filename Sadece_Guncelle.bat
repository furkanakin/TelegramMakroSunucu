@echo off
title Telegram Macro Sadece Guncelle
echo [1/2] Guncellemeler kontrol ediliyor...
git fetch origin main
git reset --hard origin/main
echo [2/2] NPM paketleri guncelleniyor...
call npm install
echo.
echo ===========================================
echo    GUNCELLEME TAMAMLANDI
echo ===========================================
echo.
pause
