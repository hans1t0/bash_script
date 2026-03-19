#!/bin/bash
# smb_check.sh v9 — Comprueba y reconecta un recurso Samba 4 desde macOS

# ─── CONFIGURACIÓN ──────────────────────────────────────────
SMB_SERVER="192.168.2.88"
SMB_SHARE="2TB_BACKUP"
SMB_USER="hans"
MOUNT_POINT="/Volumes/2TB_BACKUP"
LOG_FILE="$HOME/smb_monitor.log"
PROBE_FILE="$MOUNT_POINT/.smb_probe"
# ────────────────────────────────────────────────────────────

timestamp() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(timestamp)] $1" | tee -a "$LOG_FILE"; }

get_password() {
    security find-internet-password -a "$SMB_USER" -s "$SMB_SERVER" -w 2>/dev/null
}

check_server_reachable() {
    log "Comprobando conectividad con $SMB_SERVER..."
    if ping -c 3 -W 2000 "$SMB_SERVER" &>/dev/null; then
        log "  OK - Servidor alcanzable"
        return 0
    fi
    log "  ERROR - Servidor no responde al ping"
    return 1
}

check_smb_port() {
    log "Comprobando puerto SMB (445) en $SMB_SERVER..."
    if nc -z -w 3 "$SMB_SERVER" 445 &>/dev/null; then
        log "  OK - Puerto 445 abierto"
        return 0
    fi
    log "  ERROR - Puerto 445 cerrado o filtrado"
    return 1
}

is_mounted() {
    mount | grep -q "$MOUNT_POINT"
}

is_writable() {
    log "  Comprobando escritura en el volumen..."
    if timeout 5 bash -c "echo ok > '$PROBE_FILE' && cat '$PROBE_FILE'" &>/dev/null; then
        rm -f "$PROBE_FILE" &>/dev/null
        log "  OK - Volumen accesible y con escritura"
        return 0
    fi
    rm -f "$PROBE_FILE" &>/dev/null
    log "  ERROR - Volumen no responde a escritura"
    return 1
}

reconnect_smb() {
    log "Intentando reconectar el recurso SMB..."

    # Desmontar si esta montado o el directorio existe colgado
    if is_mounted || [ -d "$MOUNT_POINT" ]; then
        log "  Desmontando recurso previo..."
        diskutil unmount force "$MOUNT_POINT" &>/dev/null
        sleep 2
    fi

    # Segundo intento si el directorio sigue existiendo
    if [ -d "$MOUNT_POINT" ]; then
        log "  Punto de montaje sigue ocupado, forzando..."
        umount -f "$MOUNT_POINT" &>/dev/null
        sleep 1
    fi

    # Obtener credenciales del Keychain
    local password
    password=$(get_password)
    if [ -z "$password" ]; then
        log "  ERROR - No se encontro la contraseña en el Keychain"
        log "  Ejecuta: security add-internet-password -a \"$SMB_USER\" -s \"$SMB_SERVER\" -r \"smb \" -w \"tu_contraseña\""
        return 1
    fi

    # Abrir conexion via Finder con credenciales
    local smb_url="smb://$SMB_USER:$password@$SMB_SERVER/$SMB_SHARE"
    log "  Abriendo conexion smb://$SMB_USER:***@$SMB_SERVER/$SMB_SHARE..."
    open "$smb_url"

    # Esperar hasta 20 segundos a que el montaje aparezca
    local intentos=0
    while [ $intentos -lt 10 ]; do
        sleep 2
        if is_mounted; then
            log "  OK - Recurso reconectado correctamente"
            return 0
        fi
        intentos=$((intentos + 1))
    done

    log "  ERROR - No se pudo reconectar tras 20 segundos"
    return 1
}

# ─── EJECUCION PRINCIPAL ────────────────────────────────────
log "====== Inicio de comprobacion SMB ======"

check_server_reachable || { log "Sin red, abortando"; exit 1; }
check_smb_port         || { log "Puerto SMB cerrado, abortando"; exit 1; }

log "Comprobando estado del volumen $MOUNT_POINT..."

if ! is_mounted; then
    log "  Volumen no montado, reconectando..."
    reconnect_smb
elif ! is_writable; then
    log "  Volumen montado pero no responde, reconectando..."
    reconnect_smb
else
    log "  Volumen montado y funcional, nada que hacer"
fi

log "====== Fin de comprobacion ======"