# build-instalador.ps1 — estaja config y compila el instalador NuIde con Inno Setup.
# Uso:  powershell -File installer\build-instalador.ps1
# Requiere: target\release\nuide.exe (cargo build --release -p fresh-editor --bin nuide)
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path   # ...\installer
$repo   = Split-Path -Parent $here                          # raiz del repo
$exe    = Join-Path $repo 'target\release\nuide.exe'
$appdat = Join-Path $env:APPDATA 'fresh'

if (-not (Test-Path $exe)) { throw "Falta $exe — hace: cargo build --release -p fresh-editor --bin nuide" }

# 1. estajar la config que el instalador puede ofrecer (tema + plugins)
$cfg = Join-Path $here 'cfg'
foreach ($sub in 'themes','plugins') {
    $src = Join-Path $appdat $sub
    $dst = Join-Path $cfg $sub
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    if (Test-Path $src) {
        # solo los archivos de editor propios, no lib/ ni caches
        Get-ChildItem $src -File -Filter '*.json' -EA SilentlyContinue | Where-Object { $_.Name -notmatch 'package|tsconfig|service' } | Copy-Item -Destination $dst -Force
        Get-ChildItem $src -File -Filter '*.ts'   -EA SilentlyContinue | Where-Object { $_.Name -notmatch '\.d\.ts$' } | Copy-Item -Destination $dst -Force
    }
    Write-Host ("staged {0} -> {1}" -f $sub, (Get-ChildItem $dst -File | Measure-Object).Count)
}

# 2. localizar ISCC.exe
$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe no encontrado — instala: winget install JRSoftware.InnoSetup" }

# 3. compilar
Write-Host "Compilando con $iscc ..."
& $iscc (Join-Path $here 'nuide.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC fallo ($LASTEXITCODE)" }
$out = Join-Path $here 'out'
Get-ChildItem $out -Filter '*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1 | Format-List Name, Length, LastWriteTime
