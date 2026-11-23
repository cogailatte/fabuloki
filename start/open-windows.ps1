$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:NEXT_TELEMETRY_DISABLED = '1'

function Update-ToolPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $links = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
    $env:Path = (@($env:Path, $machine, $user, $links) -join ';' -split ';' |
        Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Install-Package($Id) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'Cần App Installer để cài qua WinGet. Cài App Installer từ Microsoft Store rồi mở lại Fabuloki.'
    }
    & winget.exe install --id $Id --exact --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "WinGet chưa cài được $Id. Xem lỗi phía trên rồi thử lại." }
    Update-ToolPath
}

function Test-Node {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { return $false }
    'import { nodePatched } from "./start/doctor.mjs"; process.exit(nodePatched(process.versions.node) ? 0 : 1)' |
        & node.exe --input-type=module -
    return ($LASTEXITCODE -eq 0)
}

function Find-Chrome {
    if ($env:FABULOKI_BROWSER_PATH -and (Test-Path -LiteralPath $env:FABULOKI_BROWSER_PATH -PathType Leaf)) { return $env:FABULOKI_BROWSER_PATH }
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    foreach ($root in @($env:ProgramFiles, $programFilesX86, $env:LOCALAPPDATA)) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'Google\Chrome\Application\chrome.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
}

function Test-Fabuloki($Url) {
    try {
        $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 3
        return ($health.ok -eq $true -and $health.checks.hyperframes -is [bool])
    } catch {
        return $false
    }
}

try {
    Update-ToolPath
    if (-not (Test-Node)) {
        Install-Package 'OpenJS.NodeJS.LTS'
        $nodeDir = Join-Path $env:ProgramFiles 'nodejs'
        if (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
        if (-not (Test-Node)) { throw 'Chưa tìm thấy phiên bản Node.js phù hợp.' }
    }

    if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
        Install-Package 'Gyan.FFmpeg'
        if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
            throw 'Chưa tìm thấy FFmpeg hoặc FFprobe.'
        }
    }

    $chrome = Find-Chrome
    if (-not $chrome) {
        Install-Package 'Google.Chrome'
        $chrome = Find-Chrome
        if (-not $chrome) { throw 'Chưa tìm thấy Google Chrome.' }
    }
    $env:FABULOKI_BROWSER_PATH = $chrome

    $url = @"
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.WEB_PORT || '6868');
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
console.log('http://127.0.0.1:' + port);
"@ | & node.exe --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Cổng WEB_PORT không hợp lệ.' }

    if (Test-Fabuloki $url) {
        Start-Process -FilePath $chrome -ArgumentList $url
        exit 0
    }

    New-Item -ItemType Directory -Path '.runtime' -Force | Out-Null
    $lockPath = Join-Path (Get-Location).Path '.runtime\windows-launcher.lock'
    try {
        $launchLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        throw 'Một cửa sổ khác đang chuẩn bị Fabuloki.'
    }

    try {
        if (Test-Fabuloki $url) {
            Start-Process -FilePath $chrome -ArgumentList $url
            exit 0
        }

        $revision = 'source'
        if ((Test-Path -LiteralPath '.git') -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
            $gitHead = & git.exe rev-parse --verify --quiet HEAD 2>$null
            if ($LASTEXITCODE -eq 0) { $revision = $gitHead }
        }
        $runtimeKey = @"
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
console.log(process.version, process.arch, hash);
"@ | & node.exe --input-type=module -
        if ($LASTEXITCODE -ne 0) { throw 'Chưa đọc được thông tin thư viện của Fabuloki.' }
        $buildKey = "$revision $runtimeKey"
        $stamp = '.runtime\windows-launcher-build'
        $files = @('node_modules', 'apps/server/dist/index.js', 'apps/web/.next/BUILD_ID', $stamp)
        if (($files | Where-Object { -not (Test-Path -LiteralPath $_) }) -or ([string](Get-Content -LiteralPath $stamp -Raw)).Trim() -ne $buildKey) {
            Write-Host 'Đang cài thư viện và chuẩn bị Fabuloki. Lần đầu có thể mất vài phút.'
            & npm.cmd ci --include=dev --include=optional --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'Cài thư viện thất bại. Xem lỗi phía trên rồi thử lại.' }
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) { throw 'Chuẩn bị ứng dụng thất bại. Xem lỗi phía trên rồi thử lại.' }
            Set-Content -LiteralPath $stamp -Value $buildKey -Encoding ascii
        }

        Write-Host 'Đang mở Fabuloki. Giữ cửa sổ này mở khi sử dụng.'
        & node.exe start/local.mjs --open
        exit $LASTEXITCODE
    } finally {
        $launchLock.Dispose()
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
