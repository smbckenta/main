# 複合機 見積・比較表作成ツール　起動スクリプト（Windows用）
#
# start.bat をダブルクリックすると、このスクリプトが動きます。
# 初回は必要な部品の取得（数分）を自動で行い、2回目以降はすぐ起動します。

$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $app

function Show($text, $color = "White") { Write-Host $text -ForegroundColor $color }

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

# --- 必要な部品の取得（初回のみ・数分かかります） ---
if (-not (Test-Path (Join-Path $app "node_modules"))) {
    Show ""
    Show "初回セットアップ中です。数分かかります…（npm install）" "Yellow"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Show "セットアップに失敗しました。この画面のメッセージを担当者にお送りください。" "Red"
        Read-Host "Enter キーで閉じます"
        exit 1
    }
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

# --- 使用中のポートを避ける ---
$port = 3100
while ((Test-NetConnection -ComputerName "localhost" -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) -and $port -lt 3110) {
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

& npx next dev -p $port
