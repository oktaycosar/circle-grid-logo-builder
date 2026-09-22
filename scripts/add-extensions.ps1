# src/ ve tests/ altindaki goreli importlara acik .ts/.tsx uzantisi ekler.
#
# Neden: Vite uzantisiz importlari cozer, fakat Node ESM (test runner) cozmez.
# Her iki ortamda da calismasi icin uzantilar acikca yazilir.
#
# ONEMLI: Bu script dosyalari .NET IO ile acikca UTF-8 olarak okur ve BOM'suz
# UTF-8 olarak yazar. Get-Content/Set-Content kullanmak BOM'suz UTF-8
# dosyalarda Turkce karakterleri bozar (bkz. scripts/fix-encoding.ps1).

$ErrorActionPreference = 'Stop'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$roots = @(
    (Join-Path $PSScriptRoot '..\src'),
    (Join-Path $PSScriptRoot '..\tests')
)

$files = foreach ($root in $roots) {
    if (Test-Path $root) {
        Get-ChildItem -Path $root -Recurse -Include *.ts, *.tsx -File
    }
}

$changed = 0
$pattern = "from\s+'(?<spec>\.[^']*)'"

foreach ($file in $files) {
    $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    $dir = $file.DirectoryName

    $updated = [regex]::Replace($text, $pattern, {
        param($m)
        $spec = $m.Groups['spec'].Value
        if ($spec -match '\.(ts|tsx|css|json)$') { return $m.Value }
        $base = Join-Path $dir $spec
        $target = $null
        if (Test-Path "$base.ts") { $target = "$spec.ts" }
        elseif (Test-Path "$base.tsx") { $target = "$spec.tsx" }
        elseif (Test-Path "$base\index.ts") { $target = "$spec/index.ts" }
        if (-not $target) { return $m.Value }
        return "from '$target'"
    })

    if ($updated -ne $text) {
        [System.IO.File]::WriteAllText($file.FullName, $updated, $utf8)
        $changed++
        Write-Host "guncellendi: $($file.Name)"
    }
}

Write-Host "Toplam guncellenen dosya: $changed"
