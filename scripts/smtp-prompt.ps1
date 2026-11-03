Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'MineSPbSO — пароль почты'
$form.TopMost = $true
$form.ClientSize = New-Object Drawing.Size(420,155)
$form.StartPosition = 'CenterScreen'
$label = New-Object Windows.Forms.Label
$label.Text = 'Пароль приложения Яндекс Почты (можно вставить Ctrl+V)'
$label.SetBounds(12,15,400,24)
$box = New-Object Windows.Forms.TextBox
$box.SetBounds(12,44,390,28)
$box.UseSystemPasswordChar = $true
# Masked WinForms fields can suppress standard clipboard shortcuts.
$box.Add_KeyDown({
 if ($_.Control -and $_.KeyCode -eq [Windows.Forms.Keys]::V) {
   $box.SelectedText = [Windows.Forms.Clipboard]::GetText()
   $_.SuppressKeyPress = $true
 }
})
$ok = New-Object Windows.Forms.Button
$ok.Text = 'Запустить'
$ok.SetBounds(292,92,110,32)
$ok.DialogResult = [Windows.Forms.DialogResult]::OK
$form.Controls.AddRange(@($label,$box,$ok))
$form.AcceptButton = $ok
$form.Add_Shown({$form.Activate(); [void]$box.Focus()})
try {
 if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK -or !$box.Text.Length) {exit 2}
 # stdout is an anonymous pipe to the supervisor, never the terminal.
 if (![Console]::IsOutputRedirected) {throw 'Запускайте Start-MineSPbSO.cmd'}
 [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
 [Console]::Write($box.Text)
} finally {$box.Clear();$form.Dispose()}
