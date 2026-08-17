<#
.SYNOPSIS
  Google ドライブ上の作業フォルダ ▲0Claude を、この PC の既定の作業場所として設定する。

.DESCRIPTION
  Google Drive for Desktop でマウントされた ▲0Claude フォルダを自動検出し、

    - 環境変数 CLAUDE_WORKSPACE にパスを永続化する
    - PowerShell プロファイルに ws / cws 関数を追加する
        ws   ... ▲0Claude へ移動する
        cws  ... ▲0Claude へ移動して claude を起動する

  を行う。何度実行しても安全（プロファイル内の該当ブロックを差し替える）。

.PARAMETER Path
  自動検出に失敗する場合に、▲0Claude のパスを明示する。
  例: -Path 'G:\共有ドライブ\★Kevin\▲0Claude'

.PARAMETER DryRun
  実際には変更せず、行う内容だけを表示する。

.EXAMPLE
  .\scripts\setup-workspace.ps1
  .\scripts\setup-workspace.ps1 -Path 'G:\共有ドライブ\★Kevin\▲0Claude'
  .\scripts\setup-workspace.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$FolderName   = '▲0Claude'
$BeginMarker  = '# >>> claude-config workspace >>>'
$EndMarker    = '# <<< claude-config workspace <<<'

function Write-Note { param($m) Write-Host "  $m" -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 1. ▲0Claude の場所を特定する
# ---------------------------------------------------------------------------
function Find-Workspace {
    # 共有ドライブは Google Drive for Desktop 上で
    #   <ドライブ>:\共有ドライブ\<共有ドライブ名>\▲0Claude
    # に見える（英語表示の場合は "Shared drives"）。
    $containers = @('共有ドライブ', 'Shared drives', 'マイドライブ', 'My Drive')

    $roots = @()
    foreach ($d in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        if ($d.Root) { $roots += $d.Root }
    }
    # Drive for Desktop の既定は G:。まだ PSDrive に出ていない場合に備えて補う。
    foreach ($letter in 'G', 'H', 'I', 'J') {
        $roots += "${letter}:\"
    }
    if ($env:USERPROFILE) {
        $roots += (Join-Path $env:USERPROFILE 'Google Drive')
    }
    $roots = $roots | Select-Object -Unique

    foreach ($root in $roots) {
        foreach ($container in $containers) {
            $base = Join-Path $root $container
            if (-not (Test-Path -LiteralPath $base)) { continue }

            # <base>\▲0Claude と <base>\*\▲0Claude（共有ドライブ名を挟む場合）を探す
            $direct = Join-Path $base $FolderName
            if (Test-Path -LiteralPath $direct) { return (Resolve-Path -LiteralPath $direct).Path }

            $children = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue
            foreach ($child in $children) {
                $nested = Join-Path $child.FullName $FolderName
                if (Test-Path -LiteralPath $nested) { return (Resolve-Path -LiteralPath $nested).Path }
            }
        }
    }
    return $null
}

if ($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "指定されたパスが見つかりません: $Path"
    }
    $Workspace = (Resolve-Path -LiteralPath $Path).Path
    Write-Host "作業フォルダ (指定): $Workspace"
} else {
    Write-Host "Google ドライブ上の $FolderName を探しています..."
    $Workspace = Find-Workspace
    if (-not $Workspace) {
        Write-Host ""
        Write-Warning "$FolderName が見つかりませんでした。"
        Write-Host "次を確認してください:"
        Write-Host "  1. Google Drive for Desktop が起動し、共有ドライブが同期されているか"
        Write-Host "  2. エクスプローラーで実際のパスを確認し、-Path で明示する"
        Write-Host "     例: .\scripts\setup-workspace.ps1 -Path 'G:\共有ドライブ\★Kevin\$FolderName'"
        exit 1
    }
    Write-Host "作業フォルダ: $Workspace"
}
Write-Host ""

# ---------------------------------------------------------------------------
# 2. 環境変数 CLAUDE_WORKSPACE を永続化する
# ---------------------------------------------------------------------------
Write-Host "環境変数 CLAUDE_WORKSPACE を設定します"
if ($DryRun) {
    Write-Note "[dry-run] setx 相当: CLAUDE_WORKSPACE = $Workspace"
} else {
    try {
        [Environment]::SetEnvironmentVariable('CLAUDE_WORKSPACE', $Workspace, 'User')
        $env:CLAUDE_WORKSPACE = $Workspace
        Write-Note "CLAUDE_WORKSPACE = $Workspace"
    } catch {
        Write-Warning "ユーザー環境変数を設定できませんでした: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# 3. PowerShell プロファイルに ws / cws を追加する
# ---------------------------------------------------------------------------
function Get-ProfileTargets {
    $targets = @()
    if ($PROFILE -and $PROFILE.CurrentUserAllHosts) { $targets += $PROFILE.CurrentUserAllHosts }

    # Windows PowerShell 5.1 と PowerShell 7 の両方に入れておく
    $docs = [Environment]::GetFolderPath('MyDocuments')
    if ($docs) {
        $targets += Join-Path $docs 'WindowsPowerShell\profile.ps1'
        $targets += Join-Path $docs 'PowerShell\profile.ps1'
    }
    return ($targets | Where-Object { $_ } | Select-Object -Unique)
}

$block = @"
$BeginMarker
# Claude Code の作業フォルダ (Google ドライブ ▲0Claude)
`$env:CLAUDE_WORKSPACE = '$Workspace'
function ws  { Set-Location -LiteralPath `$env:CLAUDE_WORKSPACE }
function cws { ws; claude @args }
$EndMarker
"@

foreach ($profilePath in (Get-ProfileTargets)) {
    Write-Host "プロファイル: $profilePath"

    $existing = ''
    if (Test-Path -LiteralPath $profilePath) {
        $existing = [System.IO.File]::ReadAllText($profilePath)
    }

    # 既存の管理ブロックを取り除いてから追記する（冪等）
    $pattern = [regex]::Escape($BeginMarker) + '.*?' + [regex]::Escape($EndMarker) + '\r?\n?'
    $cleaned = [regex]::Replace($existing, $pattern, '', 'Singleline')
    if ($cleaned.Length -gt 0 -and -not $cleaned.EndsWith("`n")) { $cleaned += [Environment]::NewLine }
    $newContent = $cleaned + $block + [Environment]::NewLine

    if ($newContent -eq $existing) {
        Write-Note "変更なし（設定済み）"
        continue
    }
    if ($DryRun) {
        Write-Note "[dry-run] ws / cws 関数を書き込み"
        continue
    }

    $dir = Split-Path -Parent $profilePath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    # Windows PowerShell 5.1 は BOM 無しのファイルを ANSI として読むため、
    # 日本語を含むプロファイルは必ず UTF-8 BOM 付きで書く
    [System.IO.File]::WriteAllText($profilePath, $newContent, (New-Object System.Text.UTF8Encoding $true))
    Write-Note "ws / cws 関数を書き込みました"
}

# ---------------------------------------------------------------------------
# 4. 案内
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "完了しました。新しい PowerShell を開くと次が使えます:"
Write-Host "    ws     ->  $Workspace へ移動"
Write-Host "    cws    ->  移動して claude を起動"
Write-Host ""
Write-Host "注意:"
Write-Host "  - Google ドライブ上で git リポジトリを扱うと、同期の競合で .git が壊れることがあります。"
Write-Host "    同じリポジトリを 2 台で同時に触らないでください。"
Write-Host "  - 対象フォルダは Drive の設定で「オフラインで利用可能」にしておくと安定します。"
Write-Host "  - パスに ★ ▲ が含まれるため、コマンドで指定するときは必ず引用符で囲んでください。"
