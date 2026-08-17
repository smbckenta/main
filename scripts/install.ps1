<#
.SYNOPSIS
  このリポジトリの claude\ 配下を %USERPROFILE%\.claude\ にリンクする (Windows 用)。

.DESCRIPTION
  ディレクトリは Junction、ファイルはシンボリックリンクで接続します。
  Junction は管理者権限なしで作成できますが、ファイルのシンボリックリンクには
  「開発者モード」の有効化（設定 > プライバシーとセキュリティ > 開発者向け）
  または管理者権限が必要です。どちらも無い場合はコピーにフォールバックし、
  警告を表示します（その場合、変更は自動では同期されません）。

.EXAMPLE
  .\scripts\install.ps1
  .\scripts\install.ps1 -NoAdopt
  .\scripts\install.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$NoAdopt,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$SrcDir    = Join-Path $RepoRoot 'claude'
$DestDir   = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $env:USERPROFILE '.claude' }
$BackupDir = Join-Path $DestDir ("backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))

# 同期対象。~/.claude/.credentials.json と ~/.claude.json は認証情報と
# マシン固有の状態を含むため、意図的に対象外にしている。
$LinkDirs  = @('agents', 'commands', 'rules', 'skills')
$LinkFiles = @('settings.json', 'CLAUDE.md', 'keybindings.json', 'statusline.sh')

$Adopt = -not $NoAdopt

function Write-Step { param($m) Write-Host $m }
function Write-Note { param($m) Write-Host "  $m" -ForegroundColor DarkGray }

function Backup-Item {
    param([string]$Target)
    if ($DryRun) { Write-Note "[dry-run] 退避: $Target -> $BackupDir"; return }
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    Move-Item -LiteralPath $Target -Destination $BackupDir -Force
    Write-Note "退避: $Target -> $BackupDir"
}

function Get-LinkTarget {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    if ($item.LinkType) { return $item.Target | Select-Object -First 1 }
    return $null
}

function Test-AlreadyLinked {
    param([string]$Target, [string]$Src)
    $t = Get-LinkTarget -Path $Target
    if ($null -eq $t) { return $false }
    return ([System.IO.Path]::GetFullPath($t).TrimEnd('\')) -eq ([System.IO.Path]::GetFullPath($Src).TrimEnd('\'))
}

Write-Host "リポジトリ: $RepoRoot"
Write-Host "リンク先  : $DestDir"
if ($DryRun) { Write-Host "(dry-run: 実際には変更しません)" -ForegroundColor Yellow }
Write-Host ""

if (-not (Test-Path $SrcDir)) {
    throw "$SrcDir が見つかりません。リポジトリのルートから実行してください。"
}
if (-not $DryRun -and -not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}

$fellBackToCopy = $false

foreach ($name in $LinkDirs) {
    $src    = Join-Path $SrcDir  $name
    $target = Join-Path $DestDir $name
    if (-not (Test-Path $src)) { continue }

    if (Test-AlreadyLinked -Target $target -Src $src) {
        Write-Step "OK   $name\ (リンク済み)"
        continue
    }

    Write-Step "設定 $name\"
    if (Test-Path $target) {
        $isLink = $null -ne (Get-LinkTarget -Path $target)
        if ($Adopt -and -not $isLink) {
            if ($DryRun) {
                Write-Note "[dry-run] $target\ の中身をリポジトリへコピー（既存は保持）"
            } else {
                Get-ChildItem -LiteralPath $target -Force | ForEach-Object {
                    $d = Join-Path $src $_.Name
                    if (-not (Test-Path $d)) { Copy-Item -LiteralPath $_.FullName -Destination $d -Recurse -Force }
                }
                Write-Note "取り込み: $target\ の中身をリポジトリへコピー（既存は保持）"
            }
        }
        Backup-Item -Target $target
    }

    if ($DryRun) { Write-Note "[dry-run] Junction: $target -> $src"; continue }
    # Junction は管理者権限なしで作成できる
    New-Item -ItemType Junction -Path $target -Target $src | Out-Null
    Write-Note "リンク: $target -> $src"
}

foreach ($name in $LinkFiles) {
    $src    = Join-Path $SrcDir  $name
    $target = Join-Path $DestDir $name

    if (-not (Test-Path $src)) {
        if ($Adopt -and (Test-Path $target) -and ($null -eq (Get-LinkTarget -Path $target))) {
            Write-Step "設定 $name"
            if ($DryRun) { Write-Note "[dry-run] 取り込み: $target -> $src" }
            else { Copy-Item -LiteralPath $target -Destination $src -Force; Write-Note "取り込み: $target -> $src" }
        } else { continue }
    }

    if (Test-AlreadyLinked -Target $target -Src $src) {
        Write-Step "OK   $name (リンク済み)"
        continue
    }

    Write-Step "設定 $name"
    if (Test-Path $target) { Backup-Item -Target $target }
    if ($DryRun) { Write-Note "[dry-run] SymbolicLink: $target -> $src"; continue }

    try {
        New-Item -ItemType SymbolicLink -Path $target -Target $src | Out-Null
        Write-Note "リンク: $target -> $src"
    } catch {
        try {
            New-Item -ItemType HardLink -Path $target -Target $src | Out-Null
            Write-Note "ハードリンク: $target -> $src (同一ドライブ上)"
        } catch {
            Copy-Item -LiteralPath $src -Destination $target -Force
            Write-Warning "$name をリンクできなかったためコピーしました。開発者モードを有効にして再実行してください。"
            $fellBackToCopy = $true
        }
    }
}

Write-Host ""
Write-Host "完了しました。"
if (Test-Path $BackupDir) {
    Write-Host "元の設定は $BackupDir に残してあります。問題なければ削除してください。"
}
if ($fellBackToCopy) {
    Write-Warning "一部がコピーになっています。この状態では変更が自動同期されません。"
    Write-Warning "設定 > プライバシーとセキュリティ > 開発者向け で開発者モードを有効にしてから、このスクリプトを再実行してください。"
}

if ($Adopt -and -not $DryRun) {
    Push-Location $RepoRoot
    try {
        $dirty = git status --porcelain
        if ($dirty) {
            Write-Host ""
            Write-Host "リポジトリに取り込まれた変更があります。中身を確認してからコミットしてください:"
            Write-Host "    git -C `"$RepoRoot`" status"
        }
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "次にこの PC で必要な手順（各 PC で1回ずつ・同期対象外）:"
Write-Host "  1. claude を起動してログイン（認証情報は PC ごとに保存されます）"
Write-Host "  2. 必要な MCP サーバーを追加:  claude mcp add --scope user <name> ..."
Write-Host "  3. 必要なプラグインを追加:      claude plugin marketplace add <owner/repo>"
Write-Host "     詳細は docs\per-machine-setup.md を参照してください。"
