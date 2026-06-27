; ACTIG NSIS customisation — registers run-on-boot and cleans up on uninstall.
;
; Requirement 1 ("runs when pc power is turned on") + permanence are achieved two ways:
;   1. Electron's login-item (HKCU Run) — set by the app on first run.
;   2. A Scheduled Task at logon (more robust) — created here during install.
; Requirement 17 cleanup: on uninstall we restore the user's original wallpaper.

!macro customInstall
  ; Create a logon-triggered Scheduled Task so ACTIG starts automatically and permanently.
  nsExec::ExecToLog 'schtasks /Create /TN "ACTIG Assistant" /TR "\"$INSTDIR\ACTIG.exe\" --hidden" /SC ONLOGON /RL HIGHEST /F'

  ; Seed the per-user data dir marker so first-run setup knows it's a fresh install.
  CreateDirectory "$LOCALAPPDATA\ACTIG"
!macroend

!macro customUnInstall
  ; Remove autostart task.
  nsExec::ExecToLog 'schtasks /Delete /TN "ACTIG Assistant" /F'

  ; Restore the original desktop wallpaper if ACTIG replaced it (requirement 17).
  nsExec::ExecToLog '"$INSTDIR\resources\native\wallpaper-host.exe" detach'

  ; Note: user history/secrets in %LOCALAPPDATA%\ACTIG are intentionally left in place
  ; unless the user ticks "remove my data" (handled by the app's uninstall helper).
!macroend
