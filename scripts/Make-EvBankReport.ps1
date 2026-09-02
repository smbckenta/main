<#
.SYNOPSIS
    「【EVPT】エレベーター特約店管理表」を銀行提出用の A3 Excel にして共有ドライブへ保存します。

.DESCRIPTION
    ダウンロード済みの .xlsx を渡すだけで
        G:\共有ドライブ\★Kevin\☆重要\f\EV関連\【EVPT】エレベーター特約店管理表YYMMDD.xlsx
    に保存します（YYMMDD = 作成日）。ファイルを省略すると、ダウンロードフォルダにある
    いちばん新しい 【EVPT】〜.xlsx を自動で拾います。

.EXAMPLE
    .\scripts\Make-EvBankReport.ps1
    .\scripts\Make-EvBankReport.ps1 -Source "$HOME\Downloads\管理表.xlsx" -Pages 4
#>
[CmdletBinding()]
param(
    # 変換元。省略するとダウンロードフォルダの最新 xlsx を使います
    [string] $Source,
    # A3 で何ページに収めるか（少ないほど文字は小さくなります）
    [int]    $Pages = 5,
    # 保存先フォルダ
    [string] $OutDir = 'G:\共有ドライブ\★Kevin\☆重要\f\EV関連',
    # ファイル名の日付 YYMMDD。省略すると本日
    [string] $Date,
    # 保存後にフォルダを開かない
    [switch] $NoOpen
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

$script = Join-Path $PSScriptRoot 'make_ev_bank_report.py'
if (-not (Test-Path -LiteralPath $script)) {
    throw "変換スクリプトが見つかりません: $script"
}

# --- Python を探す -------------------------------------------------------
$python = $null
foreach ($candidate in @('py', 'python', 'python3')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $python = $candidate; break }
}
if (-not $python) { throw 'Python が見つかりません。https://www.python.org/ からインストールしてください。' }
$pyArgs = if ($python -eq 'py') { @('-3', $script) } else { @($script) }

# openpyxl が無ければ入れる
& $python @($pyArgs[0..($pyArgs.Length - 2)] + '-c', 'import openpyxl') 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'openpyxl をインストールします...' -ForegroundColor Yellow
    & $python @($pyArgs[0..($pyArgs.Length - 2)] + '-m', 'pip', 'install', '--quiet', 'openpyxl')
}

# --- 変換元を決める ------------------------------------------------------
if (-not $Source) {
    $downloads = Join-Path $HOME 'Downloads'
    $latest = Get-ChildItem -LiteralPath $downloads -Filter '*.xlsx' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*EVPT*' -and $_.Name -notlike '~$*' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) {
        throw "ダウンロードフォルダに 【EVPT】〜.xlsx が見つかりません。`n" +
              "スプレッドシートを『ファイル > ダウンロード > Microsoft Excel (.xlsx)』で保存してから、" +
              'もう一度実行してください。'
    }
    $Source = $latest.FullName
    Write-Host "変換元: $Source" -ForegroundColor DarkGray
}
if (-not (Test-Path -LiteralPath $Source)) { throw "ファイルが見つかりません: $Source" }

# --- 実行 ----------------------------------------------------------------
$argList = $pyArgs + @((Resolve-Path -LiteralPath $Source).Path, '-o', $OutDir, '--pages', $Pages)
if ($Date) { $argList += @('--date', $Date) }

& $python @argList
if ($LASTEXITCODE -ne 0) { throw '変換に失敗しました。上のメッセージを確認してください。' }

if (-not $NoOpen) { Start-Process explorer.exe $OutDir }
