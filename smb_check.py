#!/usr/bin/env python3
# smb_check.py v3 — Comprueba y reconecta un recurso Samba 4 desde macOS

import subprocess
import logging
import sys
import time
from pathlib import Path

# ─── CONFIGURACIÓN ──────────────────────────────────────────
SMB_SERVER = "192.168.2.88"
SMB_SHARE = "2TB_BACKUP"
SMB_USER = "hans"
MOUNT_POINT = "/Volumes/2TB_BACKUP"
PROBE_FILE = MOUNT_POINT + "/.smb_probe"
LOG_FILE = Path.home() / "smb_monitor.log"
APP_NAME = "Monitor SMB"
# ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.info


def run(cmd: list, timeout: int = 10) -> int:
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
        return result.returncode
    except (subprocess.TimeoutExpired, Exception):
        return -1


def run_output(cmd: list, timeout: int = 10) -> str:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, Exception):
        return ""


def notify(title: str, message: str) -> None:
    applescript = (
        f'display notification "{message}" '
        f'with title "{APP_NAME}" '
        f'subtitle "{title}"'
    )
    try:
        subprocess.run(
            ["osascript", "-e", applescript],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except Exception:
        pass


def get_password() -> str:
    return run_output([
        "/usr/bin/security",
        "find-internet-password",
        "-a", SMB_USER,
        "-s", SMB_SERVER,
        "-w"
    ], timeout=5)


# ─── COMPROBACIONES ─────────────────────────────────────────

def check_server_reachable() -> bool:
    log("Comprobando conectividad con %s...", SMB_SERVER)
    if run(["/sbin/ping", "-c", "3", "-W", "2000", SMB_SERVER]) == 0:
        log("  OK - Servidor alcanzable")
        return True
    log("  ERROR - Servidor no responde al ping")
    return False


def check_smb_port() -> bool:
    log("Comprobando puerto SMB (445) en %s...", SMB_SERVER)
    if run(["/usr/bin/nc", "-z", "-w", "3", SMB_SERVER, "445"], timeout=8) == 0:
        log("  OK - Puerto 445 abierto")
        return True
    log("  ERROR - Puerto 445 cerrado o filtrado")
    return False


def is_mounted() -> bool:
    return MOUNT_POINT in run_output(["/sbin/mount"])


def is_writable() -> bool:
    log("  Comprobando escritura en el volumen...")
    rc = run(
        ["/bin/bash", "-c", f"echo ok > '{PROBE_FILE}' && cat '{PROBE_FILE}'"],
        timeout=5,
    )
    subprocess.run(["/bin/rm", "-f", PROBE_FILE],
                   stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    if rc == 0:
        log("  OK - Volumen accesible y con escritura")
        return True
    log("  ERROR - Volumen no responde a escritura")
    return False


# ─── RECONEXION ─────────────────────────────────────────────

def reconnect_smb() -> None:
    log("Intentando reconectar el recurso SMB...")

    mount_path = Path(MOUNT_POINT)
    if is_mounted() or mount_path.exists():
        log("  Desmontando recurso previo...")
        run(["/usr/sbin/diskutil", "unmount", "force", MOUNT_POINT])
        time.sleep(2)

    if mount_path.exists():
        log("  Punto de montaje sigue ocupado, forzando...")
        run(["/sbin/umount", "-f", MOUNT_POINT])
        time.sleep(1)

    # Obtener credenciales del Keychain
    password = get_password()
    if not password:
        log("  ERROR - No se encontro la contraseña en el Keychain")
        log(
            f'  Ejecuta: security add-internet-password -a "{SMB_USER}" -s "{SMB_SERVER}" -r "smb " -w "tu_contraseña"')
        notify("Error al reconectar",
               "No se encontro la contraseña en el Keychain")
        return

    # Abrir conexion via Finder con credenciales
    smb_url = f"smb://{SMB_USER}:{password}@{SMB_SERVER}/{SMB_SHARE}"
    log("  Abriendo conexion smb://%s:***@%s/%s...",
        SMB_USER, SMB_SERVER, SMB_SHARE)
    subprocess.Popen(["/usr/bin/open", smb_url])

    # Esperar hasta 20 segundos a que el montaje aparezca
    for _ in range(10):
        time.sleep(2)
        if is_mounted():
            log("  OK - Recurso reconectado correctamente")
            notify("Recurso reconectado",
                   f"{SMB_SHARE} vuelve a estar disponible")
            return

    log("  ERROR - No se pudo reconectar tras 20 segundos")
    notify("Error al reconectar",
           f"No se pudo montar {SMB_SHARE}. Revisa el log.")


# ─── EJECUCION PRINCIPAL ────────────────────────────────────

def main() -> None:
    log("====== Inicio de comprobacion SMB ======")

    if not check_server_reachable():
        notify("Sin conexion",
               f"No se puede alcanzar el servidor {SMB_SERVER}")
        log("Sin red, abortando")
        sys.exit(1)

    if not check_smb_port():
        notify("Puerto SMB cerrado",
               f"El puerto 445 de {SMB_SERVER} no responde")
        log("Puerto SMB cerrado, abortando")
        sys.exit(1)

    log("Comprobando estado del volumen %s...", MOUNT_POINT)

    if not is_mounted():
        log("  Volumen no montado, reconectando...")
        notify("Recurso desconectado",
               f"{SMB_SHARE} no esta montado - reconectando...")
        reconnect_smb()
    elif not is_writable():
        log("  Volumen montado pero no responde, reconectando...")
        notify("Recurso colgado", f"{SMB_SHARE} no responde - reconectando...")
        reconnect_smb()
    else:
        log("  Volumen montado y funcional, nada que hacer")

    log("====== Fin de comprobacion ======")


if __name__ == "__main__":
    main()
