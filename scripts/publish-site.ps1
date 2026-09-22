<#
.SYNOPSIS
  Derlenmis siteyi (dist/) AYRI bir PUBLIC depoya yayimlar; KAYNAK depo private kalir.

.DESCRIPTION
  GitHub Pages, ucretsiz planda yalnizca public depolarda acilabiliyor
  (kaynak depo private oldugu icin "deploy-pages" is akisi yayimlama adimini atlar).
  Bu betik kaynak depoyu public yapmadan siteyi yayina almak icin YALNIZCA derlenmis
  ciktiyi (dist/ icerigi + .nojekyll) yeni bir public depoya gonderir ve Pages'i acar.
  Boylece kaynak kod, git gecmisi ve depodaki telifli referans videolari public olmaz.

.PARAMETER Publish
  Verilmezse hicbir sey yayimlanmaz; sadece derleme yapilir ve yayina hazir klasor
  hazirlanir (kuru calistirma). Gercek yayin icin bu anahtar sart.

.EXAMPLE
  # 1) Once deneme (hicbir sey olusturmaz)
  powershell -File scripts/publish-site.ps1

  # 2) Gercek yayin (public depoyu olusturur/gunceller, Pages'i acar)
  powershell -File scripts/publish-site.ps1 -Publish
#>
param(
  [string]$Owner = 'oktaycosar',
  [string]$SiteRepo = 'circle-grid-logo-builder-site',
  [string]$Branch = 'main',
  [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP 'logo-site-publish'
$repoFull = "$Owner/$SiteRepo"
$pagesUrl = "https://$Owner.github.io/$SiteRepo/"

Write-Host "==> 1/4 Derleme (npm run build)" -ForegroundColor Cyan
Push-Location $root
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Derleme basarisiz (npm run build)." }
} finally { Pop-Location }

Write-Host "==> 2/4 Yayin klasoru hazirlaniyor: $stage" -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item (Join-Path $root 'dist\*') $stage -Recurse -Force
# Jekyll islemesini kapat (alt cizgi ile baslayan dosya adlari korunsun)
New-Item -ItemType File -Path (Join-Path $stage '.nojekyll') -Force | Out-Null

$files = Get-ChildItem $stage -Recurse -File
$totalMb = [math]::Round((($files | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host ("    {0} dosya, {1} MB" -f $files.Count, $totalMb) -ForegroundColor Green

if (-not $Publish) {
  Write-Host ''
  Write-Host 'KURU CALISTIRMA - hicbir sey yayimlanmadi.' -ForegroundColor Yellow
  Write-Host "Hazir klasor : $stage"
  Write-Host "Yayin icin   : powershell -File scripts/publish-site.ps1 -Publish"
  Write-Host "Yayin adresi : $pagesUrl"
  exit 0
}

Write-Host "==> 3/4 Public depo: $repoFull" -ForegroundColor Cyan
& gh repo view $repoFull --json name,visibility 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "    Depo yok, olusturuluyor (PUBLIC)..." -ForegroundColor Yellow
  & gh repo create $repoFull --public --disable-wiki --description 'Circle Grid Logo Builder - derlenmis site (kaynak depo private)'
  if ($LASTEXITCODE -ne 0) { throw "Depo olusturulamadi: $repoFull" }
}

Push-Location $stage
try {
  if (-not (Test-Path (Join-Path $stage '.git'))) { & git init -q; & git checkout -q -b $Branch }
  & git add -A
  & git -c user.name=$Owner -c user.email="$Owner@users.noreply.github.com" commit -q -m "Site derlemesi ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" 2>$null
  & git remote remove origin 2>$null | Out-Null
  & git remote add origin "https://github.com/$repoFull.git"
  & git push -f -u origin $Branch
  if ($LASTEXITCODE -ne 0) { throw 'Push basarisiz (git kimlik bilgileri gerekli olabilir).' }
} finally { Pop-Location }

Write-Host "==> 4/4 GitHub Pages aciliyor" -ForegroundColor Cyan
$existing = & gh api "repos/$repoFull/pages" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host '    Pages zaten acik.' -ForegroundColor Green
} else {
  $body = @{ source = @{ branch = $Branch; path = '/' } } | ConvertTo-Json -Depth 4 -Compress
  $bodyFile = Join-Path $env:TEMP 'pages-body.json'
  Set-Content -Path $bodyFile -Value $body -Encoding ascii
  & gh api --method POST "repos/$repoFull/pages" --input $bodyFile | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host '    Pages acilamadi - arayuzden kontrol et: Settings > Pages.' -ForegroundColor Yellow }
  else { Write-Host '    Pages acildi.' -ForegroundColor Green }
}

Write-Host ''
Write-Host "Bitti. Site birkac dakika icinde yayinda olacak: $pagesUrl" -ForegroundColor Green
