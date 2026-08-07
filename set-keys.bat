@echo off
chcp 65001 >nul
echo.
echo ========================================
echo  Niex Browser - API Kalitlarini Sozlash
echo ========================================
echo.
echo Kalitlarni quyidagi saytlardan oling:
echo.
echo  1. GROQ (tavsiya etiladi - bepul, tezkor)
echo     https://console.groq.com/keys
echo.
echo  2. OpenRouter (yedek)
echo     https://openrouter.ai/keys
echo.
echo  3. Gemini (yedek)
echo     https://aistudio.google.com/apikey
echo.
echo ========================================
echo.

set /p GROQ_KEY="GROQ_API_KEY ni kiriting (gsk_...): "
if "%GROQ_KEY%"=="" (
    echo GROQ_API_KEY majburiy! Dastur to'xtatildi.
    pause
    exit /b 1
)

set /p OR_KEY="OPENROUTER_API_KEY (ixtiyoriy, Enter bosib o'ting): "
set /p GEM_KEY="GEMINI_API_KEY (ixtiyoriy, Enter bosib o'ting): "

echo.
echo .env fayli yangilanmoqda...

powershell -Command ^
  "(Get-Content '.env') -replace 'GROQ_API_KEY=.*', 'GROQ_API_KEY=%GROQ_KEY%' | Set-Content '.env'"

if not "%OR_KEY%"=="" (
    powershell -Command ^
      "(Get-Content '.env') -replace 'OPENROUTER_API_KEY=.*', 'OPENROUTER_API_KEY=%OR_KEY%' | Set-Content '.env'"
)

if not "%GEM_KEY%"=="" (
    powershell -Command ^
      "(Get-Content '.env') -replace 'GEMINI_API_KEY=.*', 'GEMINI_API_KEY=%GEM_KEY%' | Set-Content '.env'"
)

echo.
echo ✅ Tayyor! .env fayli yangilandi.
echo.
echo Endi quyidagini ishga tushiring:
echo   npm run dev
echo.
pause