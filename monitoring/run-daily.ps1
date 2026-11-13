# Daily run of the BAC monitoring agent (Claude Code, headless).
# Registered as the Windows scheduled task "BAC MASTER AI - veille quotidienne" (see README, Monitoring).
# It writes only inside monitoring\: records.json, reports\<date>-report.md, evidence\<date>\, logs\.
# Nothing reaches students automatically: an administrator imports the results (Administration > Veille)
# and approves each change.

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$today = Get-Date -Format 'yyyy-MM-dd'
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs "$today.log"

$claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path $claude)) { $claude = 'claude' }

$prompt = @"
Run today's monitoring cycle ($today) exactly as defined in monitoring/MASTER_PROMPT.md.

1. Read monitoring/MASTER_PROMPT.md, then monitoring/records.json (previous records and last_run) to classify each item as NEW, UPDATED or REPEATED.
2. Check the official sources first (education.gov.dz, onec.dz / bac.onec.dz, the Journal officiel), then the state media relays (aps.dz, news.radioalgerie.dz).
   Access notes: education.gov.dz is WordPress, list recent posts with /wp-json/wp/v2/posts?after=<ISO date>&per_page=100&_fields=id,date,link,title.
   If a site blocks automated access, do not try to get around it: record what is visible and mark the item partially verified.
3. Write the report to monitoring/reports/$today-report.md in the fixed format of the master prompt, update monitoring/records.json, and save copies of official documents in monitoring/evidence/$today/.
4. Never invent a date, coefficient or decision. Write only inside the monitoring folder.
"@

Set-Location $project
"[$(Get-Date -Format s)] monitoring run started" | Out-File -FilePath $log -Encoding utf8 -Append
& $claude -p $prompt `
  --allowedTools 'Read' 'Glob' 'Grep' 'WebSearch' 'WebFetch' 'Edit(monitoring/**)' 'Bash(curl:*)' `
  2>&1 | Out-File -FilePath $log -Encoding utf8 -Append
"[$(Get-Date -Format s)] monitoring run finished (exit $LASTEXITCODE)" | Out-File -FilePath $log -Encoding utf8 -Append

# Keep 60 days of logs.
Get-ChildItem $logs -Filter '*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force
