<#
.SYNOPSIS
    銀行提出用 Excel の作成をタスクスケジューラに登録し、自動で保存されるようにします。

.DESCRIPTION
    登録すると、以下のタイミングで Make-EvBankReport.ps1 が自動実行され、
        G:\共有ドライブ\★Kevin\☆重要\f\EV関連\【EVPT】エレベーター特約店管理表YYMMDD.xlsx
    が作られます（YYMMDD = 実行日）。

      * 毎月 1 日 09:00
      * ログオン時（PC を起動したとき）※同じ日付のファイルが既にあれば何もしません
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
    # 実行時刻 HH:mm
    [string] $At = '09:00',
    # A3 で何ページに収めるか
    [int]    $Pages = 5,
    # 保存先フォルダ
    [string] $OutDir = 'G:\共有ドライブ\★Kevin\☆重要\f\EV関連',
    # 登録を解除する
    [switch] $Uninstall,
    # 登録後のテスト実行をしない
    [switch] $NoRun
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

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }

# 実行時刻は地域設定に左右されないよう自前で組み立てる
$hh, $mm = ($At -split ':')
$startAt = [datetime]::Today.AddDays(1).AddHours([int] $hh).AddMinutes([int] $mm)

$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Pages {1} -OutDir "{2}" -Quiet -NoOpen' `
    -f $runner, $Pages, $OutDir

function ConvertTo-XmlText { param([string] $Text) [Security.SecurityElement]::Escape($Text) }

# タスク定義は XML で直接組み立てる。
# New-CimInstance でトリガーを作る方法は環境によってプロパティが見つからず失敗するため。
$xml = @"
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>【EVPT】エレベーター特約店管理表を銀行提出用 A3 Excel にして共有ドライブへ保存します。</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$($startAt.ToString('yyyy-MM-ddTHH:mm:ss'))</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth><Day>$DayOfMonth</Day></DaysOfMonth>
        <Months>
          <January/><February/><March/><April/><May/><June/>
          <July/><August/><September/><October/><November/><December/>
        </Months>
      </ScheduleByMonth>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$(ConvertTo-XmlText $userId)</UserId>
      <Delay>PT2M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(ConvertTo-XmlText $userId)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(ConvertTo-XmlText $shellPath)</Command>
      <Arguments>$(ConvertTo-XmlText $arguments)</Arguments>
      <WorkingDirectory>$(ConvertTo-XmlText $PSScriptRoot)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

try {
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
} catch {
    Write-Host "XML での登録に失敗したので、ユーザー指定で再試行します..." -ForegroundColor Yellow
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -User $userId -Force | Out-Null
}

Write-Host "登録しました: $TaskName" -ForegroundColor Green
Write-Host ("  実行     : 毎月 {0} 日 {1}／ログオンの 2 分後" -f $DayOfMonth, $At)
Write-Host ("  実行者   : {0}" -f $userId)
Write-Host ("  保存先   : {0}" -f $OutDir)
Write-Host ("  ログ     : {0}" -f (Join-Path $env:LOCALAPPDATA 'EvBankReport\run.log'))

if ($NoRun) { return }

Write-Host ''
Write-Host '今すぐ 1 回動かします...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

# 終わるまで待つ（最大 3 分）
Start-Sleep -Seconds 3
for ($i = 0; $i -lt 90; $i++) {
    if ((Get-ScheduledTask -TaskName $TaskName).State -ne 'Running') { break }
    Start-Sleep -Seconds 2
}
$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
if ($info.LastTaskResult -eq 0) {
    Write-Host '実行できました。保存先フォルダを確認してください。' -ForegroundColor Green
} else {
    Write-Host ("実行結果コード: {0}" -f $info.LastTaskResult) -ForegroundColor Yellow
    Write-Host 'ログの末尾を表示します:' -ForegroundColor Yellow
    $log = Join-Path $env:LOCALAPPDATA 'EvBankReport\run.log'
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 25 }
}
