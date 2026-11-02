!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    SetShellVarContext current
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Удалить сохранённый вход в MineSPbSO на этом компьютере? Аккаунт на сервере и игровые данные сохранятся." IDNO keepMineSPbSOSession
    ClearErrors
    Delete "$APPDATA\community-smp\session.bin"
    IfFileExists "$APPDATA\community-smp\session.bin" 0 keepMineSPbSOSession
    MessageBox MB_OK|MB_ICONEXCLAMATION "Не удалось удалить сохранённый вход. Закройте лаунчер и удалите session.bin из %APPDATA%\community-smp."
    keepMineSPbSOSession:
  ${EndIf}
!macroend
