@echo off
query session >session.txt
for /f "skip=1 tokens=3," %%i in (session.txt) do (
    %windir%\System32\tscon.exe %%i /dest:console
)
del session.txt
pause