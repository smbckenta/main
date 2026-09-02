<#
.SYNOPSIS
    「【EVPT】エレベーター特約店管理表」を銀行提出用の A3 Excel にして共有ドライブへ保存します。

.DESCRIPTION
    保存先の
        G:\共有ドライブ\★Kevin\☆重要\f\EV関連
    は Google ドライブ（共有ドライブ ★Kevin）のフォルダなので、ここへ保存すれば
    そのままクラウドにも他の PC にも同期されます。

    ファイル名は 【EVPT】エレベーター特約店管理表YYMMDD.xlsx（YYMMDD = 作成日）。

    変換元を省略すると、次の順に「まだ変換していない最新の xlsx」を自動で探します。
      1. 保存先フォルダ（EV関連）
      2. ダウンロードフォルダ
    末尾が 6 桁の数字のファイル（＝このスクリプトが作った提出用ファイル）は
    変換元の候補から除きます。

.EXAMPLE
    .\scripts\Make-EvBankReport.ps1
    .\scripts\Make-EvBankReport.ps1 -Source "$HOME\Downloads\管理表.xlsx" -Pages 4
    .\scripts\Make-EvBankReport.ps1 -Quiet -Force      # タスクスケジューラ用
#>
[CmdletBinding()]
param(
    # 変換元。省略すると保存先フォルダ→ダウンロードフォルダの順に最新ファイルを探します
    [string] $Source,
    # A3 で何ページに収めるか（少ないほど文字は小さくなります）
    [int]    $Pages = 5,
    # 保存先フォルダ（= Google ドライブの共有ドライブ上のフォルダ）
    [string] $OutDir = 'G:\共有ドライブ\★Kevin\☆重要\f\EV関連',
    # ファイル名の日付 YYMMDD。省略すると本日
    [string] $Date,
    # 同じ日付のファイルが既にあっても作り直す
    [switch] $Force,
    # 保存後にフォルダを開かない（自動実行時はこちら）
    [switch] $NoOpen,
    # 画面出力を抑え、エラーでも例外を投げない（タスクスケジューラ用）
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
try { $OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$logDir = Join-Path $env:LOCALAPPDATA 'EvBankReport'
$null = New-Item -ItemType Directory -Path $logDir -Force -ErrorAction SilentlyContinue
$logFile = Join-Path $logDir 'run.log'

function Write-Log {
    param([string] $Message, [string] $Color = 'Gray')
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

function Fail {
    param([string] $Message)
    Write-Log "エラー: $Message" 'Red'
    if ($Quiet) { exit 1 } else { throw $Message }
}

# 提出用ファイル（末尾が 6 桁の数字）かどうか
function Test-GeneratedReport {
    param([string] $Name)
    return [IO.Path]::GetFileNameWithoutExtension($Name) -match '\d{6}$'
}

$py = Join-Path $PSScriptRoot 'make_ev_bank_report.py'
if (-not (Test-Path -LiteralPath $py)) { Fail "変換スクリプトが見つかりません: $py" }

# --- Python を探す -------------------------------------------------------
# Microsoft Store の「アプリ実行エイリアス」は python.exe という名前だけの
# ダミーで、実行しても Store が開くだけ。実際に動くものだけを採用する。
$python = $null
foreach ($candidate in @('py', 'python', 'python3')) {
    if (-not (Get-Command $candidate -ErrorAction SilentlyContinue)) { continue }
    $probe = & $candidate '-c' 'print(1)' 2>&1
    if ($LASTEXITCODE -eq 0 -and (($probe -join '') -match '1')) { $python = $candidate; break }
    Write-Log "$candidate は実行できないため飛ばします（Microsoft Store のダミーの可能性）" 'DarkGray'
}
if (-not $python) {
    Fail ("使える Python が見つかりません。PowerShell で次を実行してから、" +
          "PowerShell を閉じて開き直してください。`n" +
          '  winget install -e --id Python.Python.3.12')
}
Write-Log "Python: $((Get-Command $python).Source)" 'DarkGray'
# py ランチャーだけ -3 を付ける
$pyPrefix = if ($python -eq 'py') { @('-3') } else { @() }

# openpyxl が無ければ入れる
# ※ 2>$null は Windows PowerShell 5.1 で NativeCommandError になることがあるので、
#    2>&1 で変数に受けて捨てる
$null = & $python @($pyPrefix + @('-c', 'import openpyxl')) 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log 'openpyxl をインストールします...' 'Yellow'
    $pipOut = & $python @($pyPrefix + @('-m', 'pip', 'install', '--quiet', 'openpyxl')) 2>&1
    $pipOut | ForEach-Object { Write-Log ([string] $_) }
    if ($LASTEXITCODE -ne 0) { Fail 'openpyxl のインストールに失敗しました。' }
}

# --- 保存先ドライブを待つ（ログオン直後は G: がまだ現れていないことがある） ---
$outRoot = [IO.Path]::GetPathRoot($OutDir)
if ($outRoot -and -not (Test-Path -LiteralPath $outRoot)) {
    Write-Log "保存先ドライブ $outRoot を待っています..." 'DarkGray'
    for ($i = 0; $i -lt 36; $i++) {          # 5 秒 × 36 = 最大 3 分
        Start-Sleep -Seconds 5
        if (Test-Path -LiteralPath $outRoot) { break }
    }
    if (-not (Test-Path -LiteralPath $outRoot)) {
        Fail "保存先ドライブ $outRoot が見つかりません。Google ドライブが起動しているか確認してください。"
    }
}

# --- 変換元を決める ------------------------------------------------------
function Find-Source {
    foreach ($dir in @($OutDir, (Join-Path $HOME 'Downloads'))) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $hit = Get-ChildItem -LiteralPath $dir -Filter '*.xlsx' -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -like '*EVPT*' -and
                $_.Name -notlike '~$*' -and
                -not (Test-GeneratedReport $_.Name)
            } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if (-not $Source) { $Source = Find-Source }
if (-not $Source) {
    Fail ("変換元の 【EVPT】〜.xlsx が見つかりません。`n" +
          "スプレッドシートを『ファイル > ダウンロード > Microsoft Excel (.xlsx)』で保存してから、" +
          'もう一度実行してください。')
}
if (-not (Test-Path -LiteralPath $Source)) { Fail "ファイルが見つかりません: $Source" }
Write-Log "変換元: $Source" 'DarkGray'

# --- 既に同じ日付のものがあれば作らない（-Force で上書き） ---------------
$stamp = if ($Date) { $Date } else { Get-Date -Format 'yyMMdd' }
$target = Join-Path $OutDir ("【EVPT】エレベーター特約店管理表{0}.xlsx" -f $stamp)
if ((Test-Path -LiteralPath $target) -and -not $Force) {
    $srcTime = (Get-Item -LiteralPath $Source).LastWriteTime
    $dstTime = (Get-Item -LiteralPath $target).LastWriteTime
    if ($dstTime -ge $srcTime) {
        Write-Log "最新版が既にあります（変換元より新しい）: $target" 'DarkGray'
        if (-not $NoOpen -and -not $Quiet) { Start-Process explorer.exe $OutDir }
        return
    }
}

# --- 実行 ----------------------------------------------------------------
$argList = $pyPrefix + @($py, (Resolve-Path -LiteralPath $Source).Path, '-o', $OutDir, '--pages', $Pages)
if ($Date) { $argList += @('--date', $Date) }

$output = & $python @argList 2>&1
$output | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Fail '変換に失敗しました。ログを確認してください。' }

Write-Log "保存しました: $target" 'Green'
if (-not $NoOpen -and -not $Quiet) { Start-Process explorer.exe $OutDir }
