; The tray keeps Milon.exe running after the window closes. Stop it before files are replaced.
!macro customInit
  nsExec::Exec 'taskkill /F /IM Milon.exe'
  Pop $0
!macroend
