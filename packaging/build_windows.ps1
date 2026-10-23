param(
    [string]$PythonExe = '',
    [switch]$SkipNpmInstall,
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$buildRoot = Join-Path $repoRoot 'build\windows'
$releaseRoot = Join-Path $repoRoot 'release\windows'
$installerRoot = Join-Path $releaseRoot 'TOOL-TRADE-Installer'
$payloadRoot = Join-Path $installerRoot 'payload'

if (-not $PythonExe) {
    if (Test-Path $venvPython) {
        $PythonExe = $venvPython
    } else {
        $pythonLauncher = (Get-Command py.exe -ErrorAction Stop).Source
        & $pythonLauncher -3.12 -m venv $venvPython
        if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc moi truong Python 3.12 de dong goi.' }
        $PythonExe = $venvPython
    }
}
if (-not (Test-Path $PythonExe)) { throw "Khong tim thay Python de build: $PythonExe" }

function Remove-WorkspaceBuildDirectory([string]$Path) {
    $workspacePrefix = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
    $absolutePath = [IO.Path]::GetFullPath($Path)
    if (-not $absolutePath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Tu choi xoa duong dan nam ngoai workspace: $absolutePath"
    }
    if (Test-Path $absolutePath) {
        Remove-Item -LiteralPath $absolutePath -Recurse -Force
    }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Lenh that bai (exit $LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

$frontendDir = Join-Path $repoRoot 'frontend'
Push-Location $frontendDir
try {
    if (-not $SkipNpmInstall) { Invoke-Checked 'npm.cmd' @('ci') }
    Invoke-Checked 'npm.cmd' @('run', 'build')
} finally {
    Pop-Location
}

Invoke-Checked $PythonExe @('-m', 'pip', 'install', '-r', (Join-Path $repoRoot 'requirements.txt'), '-r', (Join-Path $PSScriptRoot 'requirements-build.txt'))

Remove-WorkspaceBuildDirectory $buildRoot
Remove-WorkspaceBuildDirectory $releaseRoot
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null

$backendArgs = @(
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
    '--name', 'ToolTradeBackend',
    '--distpath', (Join-Path $buildRoot 'backend-dist'),
    '--workpath', (Join-Path $buildRoot 'backend-work'),
    '--specpath', (Join-Path $buildRoot 'spec'),
    '--paths', (Join-Path $repoRoot 'backend'),
    '--collect-all', 'MetaTrader5',
    '--collect-all', 'fastapi',
    '--collect-all', 'starlette',
    '--collect-all', 'uvicorn',
    '--hidden-import', 'main',
    '--hidden-import', 'mt5_service',
    '--hidden-import', 'alert_service',
    '--hidden-import', 'runtime_paths',
    '--add-data', "$(Join-Path $repoRoot 'frontend\dist');frontend/dist",
    (Join-Path $PSScriptRoot 'backend_entry.py')
)
Invoke-Checked $PythonExe $backendArgs

$guiArgs = @(
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
    '--name', 'ToolTrade',
    '--distpath', (Join-Path $buildRoot 'gui-dist'),
    '--workpath', (Join-Path $buildRoot 'gui-work'),
    '--specpath', (Join-Path $buildRoot 'spec'),
    '--collect-all', 'webview',
    '--hidden-import', 'webview.platforms.edgechromium',
    '--hidden-import', 'webview.platforms.winforms',
    (Join-Path $repoRoot 'app.py')
)
Invoke-Checked $PythonExe $guiArgs

Copy-Item -Path (Join-Path $buildRoot 'gui-dist\ToolTrade\*') -Destination $payloadRoot -Recurse -Force
$backendPayload = Join-Path $payloadRoot 'backend'
New-Item -ItemType Directory -Path $backendPayload -Force | Out-Null
Copy-Item -Path (Join-Path $buildRoot 'backend-dist\ToolTradeBackend\*') -Destination $backendPayload -Recurse -Force

$eaPayload = Join-Path $installerRoot 'EA'
New-Item -ItemType Directory -Path $eaPayload -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'EA\DataServer.mq5') -Destination $eaPayload
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.bat') -Destination $installerRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1') -Destination $installerRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-Install.txt') -Destination $installerRoot

$privateDataNames = @('app_configs.json', 'alerts.json', 'strategies.json', 'email_config.json')
$leakedPrivateData = Get-ChildItem -Path $payloadRoot -Recurse -File | Where-Object { $_.Name -in $privateDataNames }
if ($leakedPrivateData) {
    throw "Bo cai khong duoc chua du lieu ca nhan: $($leakedPrivateData.FullName -join ', ')"
}

$zipPath = Join-Path $releaseRoot 'TOOL-TRADE-Installer.zip'
if (-not $SkipZip) {
    Compress-Archive -Path (Join-Path $installerRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
}

Write-Host ''
Write-Host 'Dong goi xong.' -ForegroundColor Green
Write-Host "Thu muc cai dat: $installerRoot"
if (-not $SkipZip) { Write-Host "Goi de chuyen sang may khac: $zipPath" }
Write-Host 'May dich khong can cai Python; MetaTrader 5 cua broker van can duoc cai va dang nhap rieng.'
