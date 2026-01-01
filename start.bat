@echo off
title Telegram Macro Automation
echo [INFO] Baslatiliyor...

:: Dosyanin varligini kontrol et
if not exist "Guncelle_ve_Baslat.bat" (
    echo [HATA] Guncelle_ve_Baslat.bat dosyasi bulunamadi!
    pause
    exit /b
)

:: Guncellemeleri kontrol et ve baslat
call Guncelle_ve_Baslat.bat

:: Eger baslatma basarisiz olursa veya geri donerse ekran kapanmasin
if %errorlevel% neq 0 (
    echo.
    echo [!] Script %errorlevel% kodu ile sonlandi.
    pause
)
