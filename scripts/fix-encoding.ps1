# add-extensions.ps1 dosyasinin yol actigi kodlama bozulmasini onarir.
#
# Sorun: Get-Content (BOM'suz UTF-8 dosyayi ANSI sanip) yanlis cozdu,
#        Set-Content -Encoding UTF8 ise BOM'lu UTF-8 yazdi -> cift kodlama.
# Cozum: mevcut metni UTF-8 olarak oku, ANSI kod sayfasiyla geri kodla
#        (orijinal UTF-8 baytlari), sonra UTF-8 olarak coz ve BOM'suz yaz.
#        Birden fazla kod sayfasi denenir, en az bozuk karakter ureten secilir.

$ErrorActionPreference = 'Stop'

$targets = @()
$targets += Get-ChildItem -Path (Join-Path $PSScriptRoot '..\src') -Recurse -Include *.ts, *.tsx -File
$targets += Get-ChildItem -Path (Join-Path $PSScriptRoot '..\tests') -Recurse -Include *.ts -File

$candidates = @(1252, 1254, 1250, 1251, 1253, 1255, 1256, 1257, 28591) |
    ForEach-Object { [System.Text.Encoding]::GetEncoding($_) }

$mojibakeMarkers = @([char]0x00C3, [char]0x00C5, [char]0x00C4, [char]0x00B1, [char]0x00B8, [char]0x00BA, [char]0xFFFD)

function Get-BadScore([string]$s) {
    $score = 0
    foreach ($m in $mojibakeMarkers) {
        $score += ([regex]::Matches($s, [regex]::Escape([string]$m))).Count
    }
    return $score
}

$repaired = 0
$skipped = 0

foreach ($file in $targets) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)

    # UTF-8 BOM varsa kaldir
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    if ($hasBom) { $bytes = $bytes[3..($bytes.Length - 1)] }

    $current = [System.Text.Encoding]::UTF8.GetString($bytes)   # BOM'suz UTF-8 cozum
    $currentScore = Get-BadScore $current

    if ($currentScore -eq 0) {
        # Bozulma yok; sadece BOM'u temizle
        if ($hasBom) {
            [System.IO.File]::WriteAllText($file.FullName, $current, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "BOM kaldirildi: $($file.Name)"
        }
        $skipped++
        continue
    }

    $best = $null
    $bestScore = [int]::MaxValue
    foreach ($enc in $candidates) {
        $rev = [System.Text.Encoding]::UTF8.GetString($enc.GetBytes($current))
        $score = Get-BadScore $rev
        if ($score -lt $bestScore) {
            $bestScore = $score
            $best = $rev
        }
    }

    [System.IO.File]::WriteAllText($file.FullName, $best, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ("onarildi: {0} (onceki bozuk={1}, sonraki={2})" -f $file.Name, $currentScore, $bestScore)
    $repaired++
}

Write-Host "Onarilan: $repaired, dokunulmayan: $skipped"
