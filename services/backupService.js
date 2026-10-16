const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.env.DATA_DIR || path.join(__dirname, "..");
const BACKUPS_DIR = path.join(ROOT_DIR, "backups");
const MAX_BACKUPS_TO_KEEP = 7; // Conservar los últimos 7 respaldos

function ensureBackupDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

/**
 * Copia un directorio de forma recursiva tolerando archivos abiertos o bloqueados
 */
function copyDirSafe(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    try {
      if (entry.isDirectory()) {
        copyDirSafe(srcPath, destPath);
      } else {
        // Ignorar sockets temporales o locks de Chromium
        if (entry.name.endsWith(".lock") || entry.name.includes("Singleton")) continue;
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (e) {
      // Ignorar errores en archivos temporales bloqueados por Chromium
    }
  }
}

/**
 * Ejecuta un respaldo completo de la base de datos y la sesión de WhatsApp
 * @param {string} trigger - 'AUTOMATIC_DAILY' | 'MANUAL_ADMIN'
 */
function createBackup(trigger = "AUTOMATIC_DAILY") {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `backup_${timestamp}`;
  const targetPath = path.join(BACKUPS_DIR, folderName);

  fs.mkdirSync(targetPath, { recursive: true });

  const filesToBackup = ["users.json", "clients.json", "templates.json"];
  const copiedFiles = [];

  // 1. Respaldar archivos JSON de la base de datos
  for (const file of filesToBackup) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) {
      const dest = path.join(targetPath, file);
      fs.copyFileSync(src, dest);
      copiedFiles.push(file);
    }
  }

  // 2. Respaldar la sesión activa de WhatsApp (.wwebjs_auth)
  const authDir = path.join(ROOT_DIR, ".wwebjs_auth");
  let authBackedUp = false;
  if (fs.existsSync(authDir)) {
    const destAuth = path.join(targetPath, ".wwebjs_auth");
    copyDirSafe(authDir, destAuth);
    authBackedUp = true;
  }

  // 3. Crear manifiesto de respaldo
  const manifest = {
    folder: folderName,
    createdAt: new Date().toISOString(),
    trigger,
    files: copiedFiles,
    hasAuthSession: authBackedUp,
    version: "2.0.0"
  };
  fs.writeFileSync(path.join(targetPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 4. Limpieza: Eliminar respaldos más antiguos que el límite
  purgeOldBackups();

  console.log(`💾 [BACKUP] Respaldo exitoso generado en: backups/${folderName} (Origen: ${trigger})`);
  return manifest;
}

/**
 * Elimina respaldos antiguos manteniendo los más recientes
 */
function purgeOldBackups() {
  try {
    ensureBackupDir();
    const items = fs.readdirSync(BACKUPS_DIR)
      .filter(name => name.startsWith("backup_"))
      .map(name => {
        const fullPath = path.join(BACKUPS_DIR, name);
        return {
          name,
          path: fullPath,
          stat: fs.statSync(fullPath)
        };
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (items.length > MAX_BACKUPS_TO_KEEP) {
      const toDelete = items.slice(MAX_BACKUPS_TO_KEEP);
      for (const item of toDelete) {
        fs.rmSync(item.path, { recursive: true, force: true });
        console.log(`🧹 [BACKUP] Limpieza de respaldo antiguo: ${item.name}`);
      }
    }
  } catch (err) {
    console.error("⚠️ Error limpiando respaldos antiguos:", err.message);
  }
}

/**
 * Lista todos los respaldos disponibles para el Administrador
 */
function listBackups() {
  ensureBackupDir();
  try {
    const items = fs.readdirSync(BACKUPS_DIR)
      .filter(name => name.startsWith("backup_"))
      .map(name => {
        const fullPath = path.join(BACKUPS_DIR, name);
        const manifestPath = path.join(fullPath, "manifest.json");
        let manifest = null;
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          } catch {}
        }
        return {
          folder: name,
          path: fullPath,
          manifest: manifest || { createdAt: fs.statSync(fullPath).mtime.toISOString(), trigger: "LEGACY" }
        };
      })
      .sort((a, b) => new Date(b.manifest.createdAt).getTime() - new Date(a.manifest.createdAt).getTime());
    return items;
  } catch {
    return [];
  }
}

/**
 * Inicia el cronómetro de respaldo diario automático
 */
function initAutoBackup() {
  ensureBackupDir();
  // Verificar si hay algún respaldo hecho en las últimas 24 horas
  const backups = listBackups();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lastBackup = backups.length > 0 ? new Date(backups[0].manifest.createdAt).getTime() : 0;

  if (now - lastBackup > ONE_DAY_MS) {
    console.log("⏰ [BACKUP] No hay respaldo reciente de las últimas 24h. Ejecutando respaldo inicial...");
    createBackup("AUTOMATIC_DAILY");
  }

  // Programar respaldo cada 24 horas
  setInterval(() => {
    try {
      console.log("⏰ [BACKUP] Ejecutando respaldo diario programado...");
      createBackup("AUTOMATIC_DAILY");
    } catch (e) {
      console.error("⚠️ [BACKUP] Error en respaldo programado:", e.message);
    }
  }, ONE_DAY_MS);
}

module.exports = {
  createBackup,
  listBackups,
  initAutoBackup
};

