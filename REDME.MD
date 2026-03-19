# Copiar los tres .plist

cp com.jancok.smbcheck.bash.plist ~/Library/LaunchAgents/
cp com.jancok.smbcheck.jxa.plist ~/Library/LaunchAgents/
cp com.jancok.smbcheck.python.plist ~/Library/LaunchAgents/

# Permisos correctos

chmod 644 ~/Library/LaunchAgents/com.jancok.smbcheck.\*.plist

# Cargar los tres

launchctl load ~/Library/LaunchAgents/com.jancok.smbcheck.bash.plist
launchctl load ~/Library/LaunchAgents/com.jancok.smbcheck.jxa.plist
launchctl load ~/Library/LaunchAgents/com.jancok.smbcheck.python.plist

# Verificar que están activos

launchctl list | grep com.jancok
