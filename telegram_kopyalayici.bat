@echo off
setlocal enabledelayedexpansion

echo ########################################################
echo #                                                      #
echo #       TELEGRAM KOPYALAYICI - KURULUM VE BASLAT       #
echo #                                                      #
echo ########################################################
echo.

:: Temel degiskenler
set "PYTHON_URL=https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe"
set "PYTHON_EXE=python_installer.exe"
set "PYTHON_CMD="

:: 1. Python kontrolü
python --version >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_CMD=python"
    goto :PYTHON_FOUND
)

py --version >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_CMD=py"
    goto :PYTHON_FOUND
)

:: 2. Python bulunamadiysa indir ve kur
echo [!] Python bulunamadi. Python indiriliyor...
echo [!] Lutfen bekleyin, bu islem biraz zaman alabilir.

:: Curl ile indir
curl -L -o "!PYTHON_EXE!" "!PYTHON_URL!"
if not exist "!PYTHON_EXE!" (
    echo [X] Indirme basarisiz oldu! Internet baglantinizi kontrol edin.
    pause
    exit /b 1
)

echo [+] Kurulum baslatiliyor...
echo [+] Lutfen gelen Windows onay penceresini (UAC) kabul edin.
start /wait "" "!PYTHON_EXE!" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

del "!PYTHON_EXE!"
echo [+] Python kuruldu. 
echo [!] Sistem degiskenlerinin guncellenmesi icin bu pencere kapatilacak.
echo [!] Lutfen calistir.bat dosyasini TEKRAR calistirin.
echo.
pause
exit /b 0

:PYTHON_FOUND
echo [+] Python bulundu: !PYTHON_CMD!
echo [+] Gereksinimler kontrol ediliyor...

:: Pip guncelleme (istege bagli, hata verirse onemseme)
!PYTHON_CMD! -m pip install --upgrade pip --user >nul 2>&1

:: PyQt5 kontrolü ve kurulumu
echo [+] PyQt5 kontrol ediliyor...
!PYTHON_CMD! -m pip install PyQt5 >nul 2>&1

:: Programi calistir
echo [+] Program baslatiliyor...
start "" !PYTHON_CMD! telegram_kopyalayici.py

if !errorlevel! neq 0 (
    echo [X] Program baslatilamadi! Hata kodu: !errorlevel!
    pause
)

exit /b 0
