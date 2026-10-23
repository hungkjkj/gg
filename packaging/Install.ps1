param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\TOOL TRADE'),
    [switch]$SkipWebViewSetup,
    [switch]$SkipShortcuts,
    [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'

$payloadDir = Join-Path $PSScriptRoot 'payload'
$webViewBootstrapper = Join-Path $env:TEMP 'MicrosoftEdgeWebView2Setup.exe'

if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'TOOL TRADE hien chi ho tro Windows 64-bit.'
}
if (-not (Test-Path (Join-Path $payloadDir 'ToolTrade.exe'))) {
    throw 'Khong tim thay file ung dung. Hay giai nen day du bo cai dat truoc khi chay.'
}
if (-not (Test-Path (Join-Path $payloadDir 'backend\ToolTradeBackend.exe'))) {
    throw 'Bo cai dat thieu backend. Hay tai lai va giai nen day du goi cai dat.'
}

Write-Host 'Dang cai TOOL TRADE vao:' $installDir
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -Path (Join-Path $payloadDir '*') -Destination $installDir -Recurse -Force

$webViewRoots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
    (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application')
) | Where-Object { $_ -and (Test-Path $_) }
$webViewInstalled = $false
foreach ($root in $webViewRoots) {
    if (Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Where-Object {
        Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')
    }) {
        $webViewInstalled = $true
        break
    }
}

if (-not $webViewInstalled -and -not $SkipWebViewSetup) {
    Write-Host 'Dang cai Microsoft Edge WebView2 Runtime (can thiet de hien thi giao dien)...'
    try {
        Invoke-WebRequest `
            -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
            -OutFile $webViewBootstrapper `
            -UseBasicParsing
        $runtimeInstaller = Start-Process `
            -FilePath $webViewBootstrapper `
            -ArgumentList '/silent', '/install' `
            -Wait `
            -PassThru
        if ($runtimeInstaller.ExitCode -ne 0) {
            Write-Warning "WebView2 Runtime cai chua thanh cong (ma $($runtimeInstaller.ExitCode)). Ung dung se hien huong dan neu runtime con thieu."
        }
    } catch {
        Write-Warning 'Khong tai duoc WebView2 Runtime. Hay ket noi Internet va cai runtime tu Microsoft Edge WebView2 neu ung dung khong mo duoc.'
    } finally {
        Remove-Item -LiteralPath $webViewBootstrapper -Force -ErrorAction SilentlyContinue
    }
}

if (-not $SkipShortcuts) {
    $startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\TOOL TRADE'
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $appShortcut = $shell.CreateShortcut((Join-Path $startMenuDir 'TOOL TRADE.lnk'))
    $appShortcut.TargetPath = Join-Path $installDir 'ToolTrade.exe'
    $appShortcut.WorkingDirectory = $installDir
    $appShortcut.Description = 'TOOL TRADE MT5'
    $appShortcut.Save()

    $desktopShortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TOOL TRADE.lnk'))
    $desktopShortcut.TargetPath = Join-Path $installDir 'ToolTrade.exe'
    $desktopShortcut.WorkingDirectory = $installDir
    $desktopShortcut.Description = 'TOOL TRADE MT5'
    $desktopShortcut.Save()
}

Write-Host ''
Write-Host 'Cai dat hoan tat. Khong can cai Python tren may nay.' -ForegroundColor Green
Write-Host 'De lay du lieu thi can cai MetaTrader 5 cua broker va dang nhap tai khoan.'
Write-Host 'Cau hinh, canh bao va nhat ky duoc luu trong LocalAppData\TOOL TRADE.'
if (-not $SkipLaunch) {
    Start-Process -FilePath (Join-Path $installDir 'ToolTrade.exe')
}
