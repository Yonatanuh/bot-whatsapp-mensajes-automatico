const fs = require("fs");
const path = require("path");

function getDataDir() {
  if (process.env.DATA_DIR) {
    try {
      if (!fs.existsSync(process.env.DATA_DIR)) {
        fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
      }
      return process.env.DATA_DIR;
    } catch {
      return path.join(__dirname, "..");
    }
  }
  return path.join(__dirname, "..");
}

const ROOT_DIR = getDataDir();
const BACKUPS_DIR = path.join(ROOT_DIR, "backups");
const MAX_BACKUPS_TO_KEEP = 10; // Conservar los últimos 10 respaldos

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
  const stats = { users: 0, clients: 0, templates: 0 };

  // 1. Respaldar archivos JSON de la base de datos y calcular estadísticas
  for (const file of filesToBackup) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) {
      try {
        const rawContent = fs.readFileSync(src, "utf-8");
        const dest = path.join(targetPath, file);
        fs.writeFileSync(dest, rawContent, "utf-8");
        copiedFiles.push(file);

        const parsed = JSON.parse(rawContent);
        if (file === "users.json" && Array.isArray(parsed)) {
          stats.users = parsed.length;
        } else if (file === "clients.json" && Array.isArray(parsed)) {
          stats.clients = parsed.length;
        } else if (file === "templates.json" && typeof parsed === "object") {
          stats.templates = Object.keys(parsed).length;
        }
      } catch (err) {
        console.warn(`⚠️ Error copiando archivo de respaldo ${file}:`, err.message);
      }
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

  // 3. Crear manifiesto de respaldo enriquecido
  const manifest = {
    folder: folderName,
    createdAt: new Date().toISOString(),
    trigger,
    files: copiedFiles,
    hasAuthSession: authBackedUp,
    stats,
    version: "2.1.0"
  };
  fs.writeFileSync(path.join(targetPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 4. Limpieza: Eliminar respaldos más antiguos que el límite
  purgeOldBackups();

  console.log(`💾 [BACKUP] Respaldo generado con éxito: ${folderName} (${stats.clients} clientes, ${stats.users} usuarios)`);
  return manifest;
}

/**
 * Restaura una copia de seguridad específica
 * @param {string} folderName - Nombre de la carpeta de respaldo
 */
function restoreBackup(folderName) {
  if (!folderName || !/^[a-zA-Z0-9_\-]+$/.test(folderName)) {
    throw new Error("Nombre de carpeta de respaldo inválido.");
  }

  ensureBackupDir();
  const sourcePath = path.join(BACKUPS_DIR, folderName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`La copia de seguridad "${folderName}" no existe.`);
  }

  const restoredFiles = [];
  const filesToRestore = ["users.json", "clients.json", "templates.json"];

  for (const file of filesToRestore) {
    const backupFile = path.join(sourcePath, file);
    if (fs.existsSync(backupFile)) {
      const dest = path.join(ROOT_DIR, file);
      fs.copyFileSync(backupFile, dest);
      restoredFiles.push(file);
    }
  }

  // Restaurar sesión de WhatsApp si existe en el respaldo
  const backupAuth = path.join(sourcePath, ".wwebjs_auth");
  let authRestored = false;
  if (fs.existsSync(backupAuth)) {
    const destAuth = path.join(ROOT_DIR, ".wwebjs_auth");
    copyDirSafe(backupAuth, destAuth);
    authRestored = true;
  }

  console.log(`♻️ [BACKUP RESTORE] Respaldo restaurado con éxito desde: ${folderName}`);
  return {
    success: true,
    folder: folderName,
    restoredFiles,
    hasAuthSession: authRestored
  };
}

/**
 * Retorna los datos completos de un respaldo para descarga/exportación
 * @param {string} folderName
 */
function getBackupDownloadData(folderName) {
  if (!folderName || !/^[a-zA-Z0-9_\-]+$/.test(folderName)) {
    throw new Error("Nombre de respaldo inválido.");
  }

  ensureBackupDir();
  const folderPath = path.join(BACKUPS_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    throw new Error("Respaldo no encontrado.");
  }

  const manifestPath = path.join(folderPath, "manifest.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {}
  }

  let users = [];
  const usersPath = path.join(folderPath, "users.json");
  if (fs.existsSync(usersPath)) {
    try { users = JSON.parse(fs.readFileSync(usersPath, "utf-8")); } catch {}
  }

  let clients = [];
  const clientsPath = path.join(folderPath, "clients.json");
  if (fs.existsSync(clientsPath)) {
    try { clients = JSON.parse(fs.readFileSync(clientsPath, "utf-8")); } catch {}
  }

  let templates = {};
  const templatesPath = path.join(folderPath, "templates.json");
  if (fs.existsSync(templatesPath)) {
    try { templates = JSON.parse(fs.readFileSync(templatesPath, "utf-8")); } catch {}
  }

  return {
    folder: folderName,
    exportedAt: new Date().toISOString(),
    manifest,
    users,
    clients,
    templates
  };
}

/**
 * Elimina respaldos antiguos manteniendo los más recientes
 */
function purgeOldBackups() {
  try {
    ensureBackupDir();
    const items = fs.readdirSync(BACKUPS_DIR)
      .filter(name => name.startsWith("backup_") && /^[a-zA-Z0-9_\-]+$/.test(name))
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
      .filter(name => name.startsWith("backup_") && /^[a-zA-Z0-9_\-]+$/.test(name))
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
          manifest: manifest || {
            folder: name,
            createdAt: fs.statSync(fullPath).mtime.toISOString(),
            trigger: "LEGACY",
            stats: { users: 0, clients: 0 }
          }
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
  const backups = listBackups();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lastBackup = backups.length > 0 ? new Date(backups[0].manifest.createdAt).getTime() : 0;

  if (now - lastBackup > ONE_DAY_MS) {
    console.log("⏰ [BACKUP] No hay respaldo reciente de las últimas 24h. Ejecutando respaldo inicial...");
    createBackup("AUTOMATIC_DAILY");
  }

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
  restoreBackup,
  getBackupDownloadData,
  listBackups,
  initAutoBackup
};
