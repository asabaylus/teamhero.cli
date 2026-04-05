# install-sync-task.ps1
# Creates a Windows Scheduled Task to run sync-meeting-notes.ps1
# every workday (Mon-Fri) at 5:00 PM Eastern Time.
#
# Run this script ONCE from an elevated (Admin) PowerShell prompt:
#   powershell -ExecutionPolicy Bypass -File install-sync-task.ps1

$TaskName   = "TeamHero - Sync Meeting Notes"
$ScriptPath = Join-Path $PSScriptRoot "sync-meeting-notes.ps1"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "Cannot find sync script at: $ScriptPath"
    exit 1
}

# Remove existing task if present (idempotent re-install)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing scheduled task."
}

# Action: run PowerShell with the sync script
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Trigger: Mon-Fri at 5:00 PM
$trigger = New-ScheduledTaskTrigger `
    -Weekly -WeeksInterval 1 `
    -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday `
    -At "17:00"

# Settings: allow start if on battery, don't stop on battery switch,
# run even if missed (e.g., laptop was asleep), 15-min execution limit
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# Register the task to run as the current user (no password prompt needed)
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Copies Google Meet notes from Google Drive to iCloud Obsidian vault for TeamHero report ingestion."

Write-Host ""
Write-Host "Scheduled task '$TaskName' created successfully."
Write-Host "  Schedule : Mon-Fri at 5:00 PM"
Write-Host "  Script   : $ScriptPath"
Write-Host "  Log      : $env:USERPROFILE\teamhero-sync-meeting-notes.log"
Write-Host ""
Write-Host "To test immediately:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "To view status:       Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "To remove:            Unregister-ScheduledTask -TaskName '$TaskName'"
