<#
.SYNOPSIS
  他の PC で行った設定変更を取り込み、リンクを張り直す (Windows 用)。
#>
[CmdletBinding()]
param(
    [switch]$NoAdopt,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()

    if (git status --porcelain) {
        Write-Host "ローカルに未コミットの変更があります:"
        git status --short
        Write-Host ""
        Write-Host "先にコミットするか退避してから再実行してください:"
        Write-Host "    git -C `"$RepoRoot`" add -A; git -C `"$RepoRoot`" commit -m 'Update Claude Code config'"
        exit 1
    }

    Write-Host "origin/$branch から取り込みます..."
    $ok = $false
    foreach ($attempt in 1..4) {
        git pull --rebase origin $branch
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        if ($attempt -lt 4) {
            $wait = [math]::Pow(2, $attempt)
            Write-Host "失敗しました。$wait 秒後に再試行します..."
            Start-Sleep -Seconds $wait
        }
    }
    if (-not $ok) { throw "取り込みに失敗しました。" }

    Write-Host ""
    & (Join-Path $PSScriptRoot 'install.ps1') -NoAdopt:$NoAdopt -DryRun:$DryRun

    Write-Host ""
    Write-Host "変更を他の PC へ共有するには:"
    Write-Host "    git -C `"$RepoRoot`" add -A"
    Write-Host "    git -C `"$RepoRoot`" commit -m 'Update Claude Code config'"
    Write-Host "    git -C `"$RepoRoot`" push -u origin $branch"
}
finally {
    Pop-Location
}
