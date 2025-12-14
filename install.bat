@echo off
echo ========================================
echo  Telegram Macro Automation - Kurulum
echo ========================================
echo.

:: Node.js kontrolu
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo Lutfen Node.js'i https://nodejs.org adresinden indirip kurun.
    pause
    exit /b 1
)

:: npm kontrolu
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [HATA] npm bulunamadi!
    pause
    exit /b 1
)

echo [INFO] Node.js surumu:
node -v
echo.

echo [INFO] Bagimliliklar yukleniyor...
echo Bu islem birkaç dakika surebilir...
echo.

:: npm install
call npm install

if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Bagimliliklar yuklenirken hata olustu!
    echo.
    echo Asagidaki adimlari deneyin:
    echo 1. Visual Studio Build Tools yukleyin
    echo 2. Python yukleyin
    echo 3. npm install windows-build-tools -g komutunu calistirin
    pause
    exit /b 1
)

:: Data klasoru olustur
if not exist "data" mkdir data

echo.
echo ========================================
echo  Kurulum tamamlandi!
echo ========================================
echo.
echo Programi baslatmak icin: npm start
echo veya start.bat dosyasini calistirin.
echo.
pause
