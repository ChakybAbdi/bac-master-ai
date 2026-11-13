# Registers (or removes) the daily monitoring run as a Windows scheduled task, for the current user.
#   Install:  powershell -ExecutionPolicy Bypass -File monitoring\install-schedule.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File monitoring\install-schedule.ps1 -Remove
param([switch]$Remove, [string]$At = '7:30am')

$name = 'BAC MASTER AI - veille quotidienne'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  "Removed scheduled task '$name'."
  return
}

$script = Join-Path $PSScriptRoot 'run-daily.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Description 'Daily official-source monitoring for BAC MASTER AI (writes only to the monitoring folder).' `
  -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"Scheduled '$name' every day at $At. Next run: $((Get-ScheduledTaskInfo -TaskName $name).NextRunTime)"
"Logs: $(Join-Path $PSScriptRoot 'logs')"
