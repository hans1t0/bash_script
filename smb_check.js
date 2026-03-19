#!/usr/bin/osascript -l JavaScript
// smb_check.js v10 — Comprueba y reconecta un recurso Samba 4 desde macOS (JXA)

// ─── CONFIGURACIÓN ──────────────────────────────────────────
const SMB_SERVER = "192.168.2.88";
const SMB_SHARE = "2TB_BACKUP";
const SMB_USER = "hans";
const MOUNT_POINT = "/Volumes/2TB_BACKUP";
const PROBE_FILE = MOUNT_POINT + "/.smb_probe";
const LOG_FILE = $.NSHomeDirectory().js + "/smb_monitor.log";
const APP_NAME = "Monitor SMB";
// ────────────────────────────────────────────────────────────

ObjC.import("Foundation");

// ─── HELPERS ────────────────────────────────────────────────

function timestamp() {
    const now = new Date();
    return now.toISOString().replace("T", " ").substring(0, 19);
}

function log(msg) {
    const line = `[${timestamp()}] ${msg}\n`;
    console.log(msg);
    const fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath($(LOG_FILE))) {
        $(line).dataUsingEncoding($.NSUTF8StringEncoding)
            .writeToFileAtomically($(LOG_FILE), true);
    } else {
        const fh = $.NSFileHandle.fileHandleForWritingAtPath($(LOG_FILE));
        fh.seekToEndOfFile;
        fh.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding));
        fh.closeFile;
    }
}

function run_cmd(args, timeout = 10) {
    const task = $.NSTask.alloc.init;
    const pipe = $.NSPipe.pipe;
    task.launchPath = $(args[0]);
    task.arguments = $(args.slice(1).map($));
    task.standardOutput = pipe;
    task.standardError = $.NSPipe.pipe;
    task.launch;

    const deadline = Date.now() + timeout * 1000;
    while (task.isRunning && Date.now() < deadline) {
        $.NSRunLoop.currentRunLoop
            .runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
    if (task.isRunning) { task.terminate; return -1; }
    return task.terminationStatus;
}

function run_cmd_output(args, timeout = 10) {
    const task = $.NSTask.alloc.init;
    const pipe = $.NSPipe.pipe;
    task.launchPath = $(args[0]);
    task.arguments = $(args.slice(1).map($));
    task.standardOutput = pipe;
    task.standardError = $.NSPipe.pipe;
    task.launch;

    const deadline = Date.now() + timeout * 1000;
    while (task.isRunning && Date.now() < deadline) {
        $.NSRunLoop.currentRunLoop
            .runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
    if (task.isRunning) { task.terminate; return ""; }

    const data = pipe.fileHandleForReading.readDataToEndOfFile;
    return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js.trim();
}

function sleep(seconds) {
    $.NSThread.sleepForTimeInterval(seconds);
}

function notify(title, message) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
        app.displayNotification(message, {
            withTitle: APP_NAME,
            subtitle: title,
        });
    } catch (_) { }
}

function getPassword() {
    return run_cmd_output([
        "/usr/bin/security",
        "find-internet-password",
        "-a", SMB_USER,
        "-s", SMB_SERVER,
        "-w"
    ], 5);
}

// ─── COMPROBACIONES ─────────────────────────────────────────

function checkServerReachable() {
    log("Comprobando conectividad con " + SMB_SERVER + "...");
    const rc = run_cmd(["/sbin/ping", "-c", "3", "-W", "2000", SMB_SERVER], 10);
    if (rc === 0) { log("  OK - Servidor alcanzable"); return true; }
    log("  ERROR - Servidor no responde al ping");
    return false;
}

function checkSmbPort() {
    log("Comprobando puerto SMB (445) en " + SMB_SERVER + "...");
    const rc = run_cmd(["/usr/bin/nc", "-z", "-w", "3", SMB_SERVER, "445"], 8);
    if (rc === 0) { log("  OK - Puerto 445 abierto"); return true; }
    log("  ERROR - Puerto 445 cerrado o filtrado");
    return false;
}

function isMounted() {
    const output = run_cmd_output(["/sbin/mount"], 5);
    return output.includes(MOUNT_POINT);
}

function isWritable() {
    log("  Comprobando escritura en el volumen...");
    const rc = run_cmd(
        ["/bin/bash", "-c", `echo ok > '${PROBE_FILE}' && cat '${PROBE_FILE}'`], 5
    );
    run_cmd(["/bin/rm", "-f", PROBE_FILE], 3);
    if (rc === 0) { log("  OK - Volumen accesible y con escritura"); return true; }
    log("  ERROR - Volumen no responde a escritura");
    return false;
}

// ─── RECONEXION ─────────────────────────────────────────────

function reconnectSmb() {
    log("Intentando reconectar el recurso SMB...");

    // Desmontar si esta montado o el directorio existe colgado
    const fm = $.NSFileManager.defaultManager;
    if (isMounted() || fm.fileExistsAtPath($(MOUNT_POINT))) {
        log("  Desmontando recurso previo...");
        run_cmd(["/usr/sbin/diskutil", "unmount", "force", MOUNT_POINT], 10);
        sleep(2);
    }

    // Segundo intento si el directorio sigue existiendo
    if (fm.fileExistsAtPath($(MOUNT_POINT))) {
        log("  Punto de montaje sigue ocupado, forzando...");
        run_cmd(["/sbin/umount", "-f", MOUNT_POINT], 5);
        sleep(1);
    }

    // Obtener credenciales del Keychain
    const password = getPassword();
    if (!password) {
        log("  ERROR - No se encontro la contraseña en el Keychain");
        log(`  Ejecuta: security add-internet-password -a "${SMB_USER}" -s "${SMB_SERVER}" -r "smb " -w "tu_contraseña"`);
        notify("Error al reconectar", "No se encontro la contraseña en el Keychain");
        return;
    }

    // Abrir conexion via Finder con credenciales
    const smb_url = `smb://${SMB_USER}:${password}@${SMB_SERVER}/${SMB_SHARE}`;
    log(`  Abriendo conexion smb://${SMB_USER}:***@${SMB_SERVER}/${SMB_SHARE}...`);
    run_cmd(["/usr/bin/open", smb_url], 5);

    // Esperar hasta 20 segundos a que el montaje aparezca
    let intentos = 0;
    while (intentos < 10) {
        sleep(2);
        if (isMounted()) {
            log("  OK - Recurso reconectado correctamente");
            notify("Recurso reconectado", `${SMB_SHARE} vuelve a estar disponible`);
            return;
        }
        intentos++;
    }

    log("  ERROR - No se pudo reconectar tras 20 segundos");
    notify("Error al reconectar", `No se pudo montar ${SMB_SHARE}. Revisa el log.`);
}

// ─── EJECUCION PRINCIPAL ─────────────────────────────────────

function main() {
    log("====== Inicio de comprobacion SMB ======");

    if (!checkServerReachable()) {
        notify("Sin conexion", `No se puede alcanzar el servidor ${SMB_SERVER}`);
        log("Sin red, abortando");
        return;
    }
    if (!checkSmbPort()) {
        notify("Puerto SMB cerrado", `El puerto 445 de ${SMB_SERVER} no responde`);
        log("Puerto SMB cerrado, abortando");
        return;
    }

    log("Comprobando estado del volumen " + MOUNT_POINT + "...");

    if (!isMounted()) {
        log("  Volumen no montado, reconectando...");
        notify("Recurso desconectado", `${SMB_SHARE} no esta montado - reconectando...`);
        reconnectSmb();
    } else if (!isWritable()) {
        log("  Volumen montado pero no responde, reconectando...");
        notify("Recurso colgado", `${SMB_SHARE} no responde - reconectando...`);
        reconnectSmb();
    } else {
        log("  Volumen montado y funcional, nada que hacer");
    }

    log("====== Fin de comprobacion ======");
}

main();