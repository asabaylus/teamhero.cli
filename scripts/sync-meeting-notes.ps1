# sync-meeting-notes.ps1
# Copies Google Meet meeting notes from Google Drive to iCloud Obsidian vault.
# Designed to run via Windows Task Scheduler every workday at 5 PM ET.

$Source      = "G:\My Drive\Obsidian"
$Destination = "C:\Users\Asa\iCloudDrive\iCloud~md~obsidian\Lumata\Meetings"
$LogFile     = "$env:USERPROFILE\teamhero-sync-meeting-notes.log"

# /MIR   = mirror (copy new/changed, skip unchanged)
#          NOTE: /MIR deletes files in dest that no longer exist in source.
#          Switch to /E if you want additive-only (never delete from dest).
# /FFT   = assume FAT file times (2-second granularity) to avoid
#          false mismatches between cloud filesystem drivers
# /Z     = restartable mode (resumes interrupted copies)
# /W:5   = wait 5 seconds between retries
# /R:3   = retry 3 times on failure
# /NP    = no progress percentage (cleaner log output)
# /LOG+  = append to log file
# /TEE   = output to console AND log file
# /XO    = exclude older files (skip if dest is same age or newer)

robocopy $Source $Destination *.md /MIR /FFT /Z /W:5 /R:3 /NP /XO /LOG+:$LogFile /TEE

$exitCode = $LASTEXITCODE
# Robocopy exit codes: 0=no changes, 1=files copied, 2=extras deleted, 3=both
# Codes 0-7 are success; 8+ indicate errors
if ($exitCode -ge 8) {
    Write-Error "Robocopy failed with exit code $exitCode. Check log: $LogFile"
    exit 1
}

Write-Host "Sync complete (robocopy exit code: $exitCode). Log: $LogFile"
exit 0
