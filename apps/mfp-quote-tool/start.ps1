# 複合機 見積・比較表作成ツール　起動スクリプト（Windows用）
#
# start.bat をダブルクリックすると、このスクリプトが動きます。
# 初回は必要な部品の取得（数分）を自動で行い、2回目以降はすぐ起動します。

$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $app

function Show($text, $color = "White") { Write-Host $text -ForegroundColor $color }

# 何が起きたか後から追えるよう、画面の内容をファイルにも残す
$log = Join-Path $app "start-log.txt"
try { Start-Transcript -Path $log -Force | Out-Null } catch { }

# 途中で失敗しても、原因が読めるように画面を閉じない
function Fail($text) {
    Show ""
    Show $text "Red"
    Show "この画面の内容（と start-log.txt）を担当者にお送りください。" "Yellow"
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host "Enter キーで閉じます"
    exit 1
}

# 想定外のエラーで画面が一瞬で閉じないよう、ここで受け止める
trap {
    Show ""
    Show "予期しないエラーが発生しました。" "Red"
    Show $_.Exception.Message "Red"
    Show "この画面の内容（と start-log.txt）を担当者にお送りください。" "Yellow"
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host "Enter キーで閉じます"
    exit 1
}

Show "=== 複合機 見積・比較表作成ツール ===" "Cyan"
Show ""

# --- Node.js の確認 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Show "Node.js が見つかりません。" "Red"
    Show ""
    Show "PowerShell で次を実行してインストールし、PCを再起動してから、もう一度この start.bat を実行してください。"
    Show "    winget install OpenJS.NodeJS.LTS" "Yellow"
    Show ""
    Show "うまくいかない場合は https://nodejs.org から LTS 版を入れてください。"
    Read-Host "Enter キーで閉じます"
    exit 1
}
Show "Node.js $(& node -v) を確認しました。" "Green"

# --- 必要な部品の取得 ---
# 新しい版に入れ替えると必要な部品が増えることがある。
# node_modules があるだけでは足りないので、package-lock.json より
# 取得記録（スタンプ）が古い場合は入れ直す。
$modules = Join-Path $app "node_modules"
$lock    = Join-Path $app "package-lock.json"
$stamp   = Join-Path $modules ".mfp-install-stamp"

$needInstall = $false
if (-not (Test-Path $modules)) {
    $needInstall = $true
} elseif (-not (Test-Path $stamp)) {
    $needInstall = $true
} elseif ((Test-Path $lock) -and ((Get-Item $lock).LastWriteTime -gt (Get-Item $stamp).LastWriteTime)) {
    $needInstall = $true
}

if ($needInstall) {
    Show ""
    Show "必要な部品を取得しています。数分かかります…（npm install）" "Yellow"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Fail "部品の取得（npm install）に失敗しました。"
    }
    Set-Content -Path $stamp -Value (Get-Date -Format o) -Encoding UTF8
    Show "部品の取得が終わりました。" "Green"
}

# --- PDF出力に使う Chromium（初回のみ・失敗しても続行） ---
$flag = Join-Path $app ".chromium-installed"
if (-not (Test-Path $flag)) {
    Show ""
    Show "PDF出力用の部品を取得中です…（初回のみ）" "Yellow"
    & npx --yes playwright install chromium
    if ($LASTEXITCODE -eq 0) {
        New-Item -ItemType File -Path $flag -Force | Out-Null
    } else {
        Show "PDF出力用の部品を取得できませんでした。Excel出力は使えます。" "Yellow"
        Show "PDFが必要な場合は、帳票プレビュー画面から Ctrl+P →「PDFとして保存」をご利用ください。" "Yellow"
    }
}

# --- データの保存先を決める ---
# 既定は Googleドライブの共有フォルダ。保存先を変えたいときは
# このフォルダに data-dir.txt を置き、1行目にフォルダのパスを書く。
$driveRoot = "G:\共有ドライブ\★Kevin\▲0Claude\複合機見積作成ツール"
$override = Join-Path $app "data-dir.txt"
if (Test-Path $override) {
    $dataDir = (Get-Content $override -Raw -Encoding UTF8).Trim()
} elseif (Test-Path "G:\共有ドライブ") {
    $dataDir = Join-Path $driveRoot "data"
} else {
    $dataDir = Join-Path $app "data"
    Show "Googleドライブ（G:）が見つからないため、データはこのPC内に保存します。" "Yellow"
}
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
$env:MFP_DATA_DIR = $dataDir
Show "データの保存先: $dataDir" "Green"

# --- AI（Claude）のAPIキー ---
# PDF・写真の読み取りに使う。保存先の api-key.txt に置いておき、
# 見つからないときだけ初回に1度たずねる（Enterのみで後回しにもできる）。
$keyFile = Join-Path $dataDir "api-key.txt"
if (Test-Path $keyFile) {
    $env:ANTHROPIC_API_KEY = (Get-Content $keyFile -Raw -Encoding UTF8).Trim()
    Show "AI読み取り用のAPIキーを読み込みました。" "Green"
} elseif (-not $env:ANTHROPIC_API_KEY) {
    Show ""
    Show "PDF・写真の読み取りに使うAIのAPIキーが未登録です。" "Yellow"
    Show "https://platform.claude.com/settings/keys で発行したキー（sk-ant-… ）を貼り付けてください。"
    Show "あとで設定画面から登録する場合は、何も入力せずに Enter を押してください。" "Gray"
    $secure = Read-Host "APIキー" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($plain) {
        # BOM無しUTF-8で保存する（アプリ側がそのまま読めるように）
        [IO.File]::WriteAllText($keyFile, $plain, (New-Object Text.UTF8Encoding($false)))
        $env:ANTHROPIC_API_KEY = $plain
        Show "APIキーを保存しました（$keyFile）。次回からは入力不要です。" "Green"
    } else {
        Show "APIキーなしで起動します。PDF・写真はOCRでの読み取りになります。" "Yellow"
    }
}

# --- 使用中のポートを避ける ---
# Test-NetConnection は1回に数秒かかるため、TCP接続を直接試して素早く判定する
function Test-PortBusy($p) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $p)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$port = 3100
while ((Test-PortBusy $port) -and $port -lt 3110) {
    $port++
}

Show ""
Show "起動しています… ブラウザが自動で開きます。" "Cyan"
Show "終了するときは、この黒い画面で Ctrl + C を押すか、画面を閉じてください。" "Gray"
Show ""

# ブラウザは起動を待ってから開く
Start-Job -ScriptBlock {
    param($p)
    for ($i = 0; $i -lt 60; $i++) {
        try {
            Invoke-WebRequest -Uri "http://localhost:$p" -UseBasicParsing -TimeoutSec 2 | Out-Null
            Start-Process "http://localhost:$p"
            break
        } catch { Start-Sleep -Seconds 1 }
    }
} -ArgumentList $port | Out-Null

$startedAt = Get-Date
& npx next dev -p $port

# すぐに終了した場合は起動失敗とみなす（Ctrl+C で止めた場合と区別する）
$ranSeconds = ((Get-Date) - $startedAt).TotalSeconds
if ($LASTEXITCODE -ne 0 -and $ranSeconds -lt 20) {
    Fail "起動に失敗しました（終了コード $LASTEXITCODE）。"
}
try { Stop-Transcript | Out-Null } catch { }
