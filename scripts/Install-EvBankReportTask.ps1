<#
.SYNOPSIS
    銀行提出用 Excel の作成をタスクスケジューラに登録し、自動で保存されるようにします。

.DESCRIPTION
    登録すると、以下のタイミングで Make-EvBankReport.ps1 が自動実行され、
        G:\共有ドライブ\★Kevin\☆重要\f\EV関連\【EVPT】エレベーター特約店管理表YYMMDD.xlsx
    が作られます（YYMMDD = 実行日）。

      * 毎月 1 日 09:00
      * ログオン時（PC を起動したとき）※前回作成から日が変わっていれば作成
      * PC が起動していなかった場合は、起動後に取りこぼしぶんを実行

    変換元は「EV関連 フォルダ」か「ダウンロードフォルダ」にある最新の
    【EVPT】〜.xlsx を自動で拾います（末尾 6 桁の提出用ファイルは除外）。

    ※管理者権限は不要です（ログオンユーザーとして実行）。

.EXAMPLE
    .\scripts\Install-EvBankReportTask.ps1
    .\scripts\Install-EvBankReportTask.ps1 -DayOfMonth 5 -At 08:30
    .\scripts\Install-EvBankReportTask.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    # タスク名
    [string] $TaskName = 'EV銀行提出用Excelの作成',
    # 毎月何日に実行するか
    [ValidateRange(1, 28)]
    [int]    $DayOfMonth = 1,
    # 実行時刻
    [string] $At = '09:00',
    # A3 で何ページに収めるか
    [int]    $Pages = 5,
    # 保存先フォルダ
    [string] $OutDir = 'G:\共有ドライブ\★Kevin\☆重要\f\EV関連',
    # 登録を解除する
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
try { $OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "登録を解除しました: $TaskName" -ForegroundColor Yellow
    } else {
        Write-Host "登録されていません: $TaskName" -ForegroundColor DarkGray
    }
    return
}

$runner = Join-Path $PSScriptRoot 'Make-EvBankReport.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw "見つかりません: $runner" }

# PowerShell 7 があればそちらを、無ければ Windows PowerShell を使う
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
$shellPath = (Get-Command $shell).Source

$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Pages {1} -OutDir "{2}" -Quiet -NoOpen' `
    -f $runner, $Pages, $OutDir

$action = New-ScheduledTaskAction -Execute $shellPath -Argument $arguments -WorkingDirectory $PSScriptRoot

# 「毎月 N 日」は New-ScheduledTaskTrigger に無いので CIM で組み立てる
$monthly = New-CimInstance -CimClass (Get-CimClass -ClassName MSFT_TaskMonthlyTrigger `
        -Namespace Root/Microsoft/Windows/TaskScheduler) -ClientOnly
$monthly.DaysOfMonth = $DayOfMonth
$monthly.MonthsOfYear = 4095          # 全 12 か月
# 時刻の解釈は地域設定に左右されないよう自前で組み立てる
$hh, $mm = ($At -split ':')
$start = [datetime]::Today.AddHours([int] $hh).AddMinutes([int] $mm)
$monthly.StartBoundary = $start.ToString('yyyy-MM-ddTHH:mm:ss')
$monthly.Enabled = $true

# ログオン時（PC を起動したとき）。同じ日付のファイルが既にあれば作成はスキップされます
$atLogon = New-ScheduledTaskTrigger -AtLogOn

$triggers = @($monthly, $atLogon)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "登録しました: $TaskName" -ForegroundColor Green
Write-Host ("  実行     : 毎月 {0} 日 {1}／ログオン時" -f $DayOfMonth, $At)
Write-Host ("  保存先   : {0}" -f $OutDir)
Write-Host ("  ログ     : {0}" -f (Join-Path $env:LOCALAPPDATA 'EvBankReport\run.log'))
Write-Host ''
Write-Host '今すぐ 1 回動かして確認します...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName
Write-Host '数十秒後に保存先フォルダを確認してください。' -ForegroundColor Cyan
