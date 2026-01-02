@echo off
title Telegram Macro Sadece Guncelle
echo [1/2] Guncellemeler kontrol ediliyor...
git fetch origin main
git reset --hard origin/main
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
