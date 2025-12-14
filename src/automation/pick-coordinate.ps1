Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MouseHelper {
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(ref POINT pt);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }
}
"@

$point = New-Object MouseHelper+POINT

# Onceki tiklama durumunu temizle - kisa bir bekleme
Start-Sleep -Milliseconds 500

# Ilk olarak mouse butonunun basilmamis oldugunu bekle
while (([MouseHelper]::GetAsyncKeyState(1) -band 0x8000) -ne 0) {
    Start-Sleep -Milliseconds 50
}

# Simdi yeni tiklama bekle
while ($true) {
    Start-Sleep -Milliseconds 50

    # Sol mouse tusu (VK_LBUTTON = 0x01)
    $keyState = [MouseHelper]::GetAsyncKeyState(1)

    if (($keyState -band 0x8000) -ne 0) {
        # Mouse pozisyonunu al
        [MouseHelper]::GetCursorPos([ref]$point) | Out-Null

        # Koordinatlari yazdir
        Write-Host "$($point.X),$($point.Y)"
        break
    }
}
