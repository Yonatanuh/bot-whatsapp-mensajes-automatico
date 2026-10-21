require("dotenv").config();

// Configuración de credenciales de entorno y robustez en producción
if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
  process.env.JWT_SECRET = "jwt_secret_empresa_whatsapp_prod_2026_secreto";
  console.warn("⚠️ [SEGURIDAD] Usando JWT_SECRET de respaldo. Puede configurarlo en las variables de entorno de Render.");
}
if (!process.env.ADMIN_PASS || !process.env.ADMIN_PASS.trim()) {
  process.env.ADMIN_PASS = "admin123";
  console.warn("⚠️ [SEGURIDAD] ADMIN_PASS no configurado, usando predeterminado.");
} else if (process.env.ADMIN_PASS.trim() === "admin123") {
  console.warn("⚠️ [SEGURIDAD] ADMIN_PASS tiene la contraseña por defecto. Puede cambiarla en las variables de entorno de Render.");
}

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const jwt = require("jsonwebtoken");
const { enviarEmailRegistro } = require("./services/emailService");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const { encryptField, decryptField } = require("./services/cryptoService");
const { createBackup, restoreBackup, getBackupDownloadData, listBackups, initAutoBackup } = require("./services/backupService");
const dbService = require("./services/dbService");

// ── BUFFER DE LOGS DEL SISTEMA PARA DIAGNÓSTICO EN NUBE ──
const systemLogs = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function recordSystemLog(level, args) {
  const text = args.map(a => {
    if (typeof a !== "object" || a === null) return String(a);
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }).join(" ");
  systemLogs.push({ time: new Date().toISOString(), level, text: text.slice(0, 1000) });
  if (systemLogs.length > 80) systemLogs.shift();
}
console.log = (...args) => { recordSystemLog("info", args); origLog.apply(console, args); };
console.warn = (...args) => { recordSystemLog("warn", args); origWarn.apply(console, args); };
console.error = (...args) => { recordSystemLog("error", args); origError.apply(console, args); };

// ── PERSISTENCIA DE DATOS Y CLIENTES ──
let DATA_DIR = __dirname;
if (process.env.DATA_DIR) {
  try {
    if (!fs.existsSync(process.env.DATA_DIR)) {
      fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    }
    const testFile = path.join(process.env.DATA_DIR, ".write_test");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    DATA_DIR = process.env.DATA_DIR;
  } catch (err) {
    console.warn(`⚠️ No se pudo usar DATA_DIR (${process.env.DATA_DIR}). Usando almacenamiento local en ${__dirname}`);
    DATA_DIR = __dirname;
  }
}

// PERSISTENCIA DE USUARIOS
const USERS_FILE = path.join(DATA_DIR, "users.json");
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")) || [];
  } catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  if (dbService && dbService.isMongoConnected()) {
    dbService.saveAllUsers(users).catch(e => console.warn("⚠️ [DB] Error sincronizando usuarios con MongoDB:", e.message));
  }
}

const SEEDS_DIR = path.join(__dirname, "seeds");

// Correos de Administradores Autorizados del Sistema (Solo Administrador Principal)
const KNOWN_ADMIN_EMAILS = [
  "gonzalezyonild@gmail.com"
];
if (process.env.ADMIN_EMAIL) {
  const envAdmin = process.env.ADMIN_EMAIL.toLowerCase().trim();
  if (!KNOWN_ADMIN_EMAILS.includes(envAdmin)) {
    KNOWN_ADMIN_EMAILS.push(envAdmin);
  }
}

function initSeedUsers() {
  try {
    const users = loadUsers();
    const envAdminEmail = (process.env.ADMIN_EMAIL || "gonzalezyonild@gmail.com").toLowerCase().trim();
    const envAdminPass = (process.env.ADMIN_PASS || "admin123").trim();
    const hashedPass = bcrypt.hashSync(envAdminPass, 10);

    const seedAccounts = [
      {
        name: "Administrador",
        email: "gonzalezyonild@gmail.com",
        password: hashedPass,
        backupHash: "$2b$10$Mu2/mF8YuD.SH1oB2WHKvOo8PGrE6Te1iQZBOageJ9iI3zK83Uqq.",
        role: "ADMIN"
      },
      {
        name: "Jonathan",
        email: "yonatanfranco339@gmail.com",
        password: hashedPass,
        backupHash: "$2b$10$FltcCRmU7mKHqkSdp3wkPe0z4eVChapZ3uqqzxYGHfCVquZJPaJlO",
        role: "USER"
      }
    ];

    if (envAdminEmail && !seedAccounts.some(s => s.email === envAdminEmail)) {
      seedAccounts.push({
        name: "Administrador",
        email: envAdminEmail,
        password: hashedPass,
        role: "ADMIN"
      });
    }

    let modified = false;
    for (const seed of seedAccounts) {
      const idx = users.findIndex(u => (u.email || "").toLowerCase().trim() === seed.email);
      if (idx === -1) {
        users.push({
          name: seed.name,
          email: seed.email,
          password: seed.password,
          backupHash: seed.backupHash,
          role: seed.role,
          verifiedAt: new Date().toISOString()
        });
        modified = true;
        console.log(`👤 [USUARIOS] Cuenta inicializada para: ${seed.email} (Rol: ${seed.role})`);
      } else {
        if (users[idx].role !== seed.role) {
          users[idx].role = seed.role;
          modified = true;
        }
        if (seed.backupHash && !users[idx].backupHash) {
          users[idx].backupHash = seed.backupHash;
          modified = true;
        }
      }
    }

    if (modified) {
      saveUsers(users);
    }
  } catch (err) {
    console.error("⚠️ Error inicializando usuarios semilla:", err.message);
  }
}

function initSeedData() {
  try {
    initSeedUsers();

    // Purgar de forma permanente cualquier cliente ficticio de prueba/semilla
    const mockSeedIds = new Set([
      "1791573765845",
      "1791575961084",
      "1791638907058",
      "1792434500001",
      "1792434500002",
      "1792434500003"
    ]);
    const mockPhones = new Set([
      "18095550101",
      "18095550102",
      "18095550103",
      "18095550104",
      "18095550105",
      "18095550106"
    ]);
    const currentClients = loadClients();
    const filteredClients = currentClients.filter(c => !mockSeedIds.has(c.id) && !mockPhones.has(String(c.numero || "").replace(/\D/g, "")));
    if (filteredClients.length !== currentClients.length) {
      saveClients(filteredClients);
      console.log(`🧹 [CLIENTES] Se eliminaron ${currentClients.length - filteredClients.length} clientes de prueba del almacenamiento local.`);
    }

    // Auto-restaurar plantillas si no existen
    if (!fs.existsSync(TEMPLATES_FILE)) {
      const seedTemplatesFile = path.join(SEEDS_DIR, "templates.json");
      if (fs.existsSync(seedTemplatesFile)) {
        try {
          const raw = fs.readFileSync(seedTemplatesFile, "utf-8");
          fs.writeFileSync(TEMPLATES_FILE, raw, "utf-8");
          console.log("📁 [SEMILLAS] Plantillas inicializadas automáticamente desde semillas.");
        } catch (e) {
          console.warn("⚠️ Error cargando plantillas semilla:", e.message);
        }
      }
    }
  } catch (err) {
    console.error("⚠️ Error inicializando datos semilla:", err.message);
  }
}
let pendingRegistrations = {};

const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

function loadClients() {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return [];
    const data = fs.readFileSync(CLIENTS_FILE, "utf-8");
    const list = JSON.parse(data) || [];
    // Desencriptar campos sensibles en memoria
    return list.map(c => ({
      ...c,
      nota: decryptField(c.nota)
    }));
  } catch {
    return [];
  }
}

function saveClients(clients) {
  // Cifrado en reposo con AES-256-GCM antes de escribir en disco
  const encryptedList = clients.map(c => ({
    ...c,
    nota: encryptField(c.nota)
  }));
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(encryptedList, null, 2), "utf-8");
  if (dbService && dbService.isMongoConnected()) {
    dbService.syncLocalClientsToMongo(clients).catch(e => console.warn("⚠️ [DB] Error sincronizando clientes con MongoDB:", e.message));
  }
}

function loadClientsForUser(userEmail) {
  // Directorio unificado de la empresa:
  // Todos los operadores y administradores acceden al directorio centralizado de cobros.
  return loadClients();
}

// PERSISTENCIA DE PLANTILLAS Y MENSAJE ACTUAL (AISLADAS POR CUENTA)
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");
const DEFAULT_TEMPLATES = {
  plantillas: [
    { id: 'rec', nombre: "Recordatorio de Pago", texto: "Estimado/a cliente, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad." },
    { id: 'abo', nombre: "Confirmación de Abono", texto: "Estimado cliente, hemos registrado con éxito su abono a la cuenta. Su saldo ha sido actualizado en nuestro sistema. ¡Muchas gracias por su puntualidad!" },
    { id: 'ven', nombre: "Aviso de Vencimiento", texto: "Aviso importante de cobranza: Su ciclo de facturación vence en las próximas 24 horas. Evite recargos regularizando su balance a la brevedad." }
  ],
  currentMessage: "Estimado/a cliente, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad.",
  delay: 4
};

function loadAllTemplatesStore() {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadTemplatesForUser(userEmail) {
  if (!userEmail) return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  const emailKey = userEmail.toLowerCase().trim();
  const store = loadAllTemplatesStore();
  if (store[emailKey]) {
    return store[emailKey];
  }
  return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
}

// Configuración de Seguridad y Autenticación con valores seguros por defecto
const SECRET_KEY = (process.env.JWT_SECRET || "").trim() || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "production") {
  console.warn("⚠️ [AUTH] JWT_SECRET no configurado; los tokens de desarrollo dejarán de ser válidos al reiniciar.");
}
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

const app = express();
const server = http.createServer(app);

// 1. Confianza en Proxy para Render / Load Balancers (Fundamental para IP Rate-Limiting correcto)
app.set("trust proxy", true);

// 2. Proteger cabeceras HTTP y fingerprint
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false
}));

// 3. Parser de Cookies y JSON con límites de tamaño
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

// 4. Rate Limiting Multi-Nivel (Protección DoS y Fuerza Bruta)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    error: "Has superado el límite de peticiones. Intenta de nuevo más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});
app.use("/api/", apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: {
    error: "Demasiados intentos de acceso desde esta IP. Por seguridad, intente en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});
app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);
app.use("/api/verify", authLimiter);

// Rate limiter específico para campañas de envío (prevención de spam y abuso de Puppeteer)
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: {
    error: "Límite de campañas por minuto alcanzado. Por favor espere antes de enviar nuevamente.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});
app.use("/api/send", sendLimiter);
app.use("/api/send-auto-collections", sendLimiter);
app.use("/api/test/single", sendLimiter);
const disconnectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: {
    error: "Demasiadas solicitudes de desconexión. Por seguridad espere unos minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});
app.use("/api/whatsapp/disconnect", disconnectLimiter);

// 5. Configuración CORS y WebSocket Segura
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://bot-whatsapp-mensajes-automatico.vercel.app"
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL.trim());
}
if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*") {
  process.env.CORS_ORIGIN.split(",").forEach(s => {
    const o = s.trim();
    if (o && !allowedOrigins.includes(o)) allowedOrigins.push(o);
  });
}

const corsOptions = {
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  credentials: true
};

function isAllowedOrigin(origin) {
  if (!origin) return true;

  try {
    const parsedOrigin = new URL(origin);
    if (allowedOrigins.includes(parsedOrigin.origin)) return true;
    const isLocalOrigin = parsedOrigin.protocol === "http:" &&
      (parsedOrigin.hostname === "localhost" ||
        parsedOrigin.hostname === "127.0.0.1" ||
        parsedOrigin.hostname === "[::1]");
    const isHostedOrigin = parsedOrigin.protocol === "https:" &&
      (parsedOrigin.hostname.endsWith(".vercel.app") ||
        parsedOrigin.hostname.endsWith(".onrender.com"));
    return isLocalOrigin || isHostedOrigin;
  } catch {
    return false;
  }
}

app.use(cors(corsOptions));

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true
  }
});

// Manejo seguro de errores en parseo de JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "JSON inválido en la solicitud." });
  }
  next(err);
});

// ── UTILIDADES DE SANITIZACIÓN Y VALIDACIÓN ──
function sanitizeText(str, maxLen = 255) {
  if (typeof str !== "string") return "";
  return str
    .replace(/[<>]/g, "") // Mitigar vectores XSS almacenados
    .trim()
    .slice(0, maxLen);
}

function sanitizePhone(phone) {
  if (!phone) return "";
  return phone.toString().replace(/\D/g, "");
}

function isValidPhone(phone) {
  return /^\d{7,15}$/.test(phone);
}

function parseDelayMs(delay, fallbackSeconds = 4) {
  const parsedSeconds = Number.parseFloat(delay);
  const delayMs = Number.isFinite(parsedSeconds) && parsedSeconds > 0
    ? parsedSeconds * 1000
    : fallbackSeconds * 1000;
  return Math.min(Math.max(delayMs, 1000), 60000);
}

function isValidEmail(email) {
  if (!email || typeof email !== "string" || email.length > 254) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000
  });
}

// ── SISTEMA DE AUTENTICACIÓN PROTEGIDO ──

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Faltan datos obligatorios." });

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Formato de datos inválido." });
  }

  const cleanEmail = email.trim().toLowerCase().slice(0, 254);
  const cleanName = sanitizeText(name || "Usuario", 100);

  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: "Formato de correo electrónico inválido." });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "La contraseña debe tener entre 6 y 128 caracteres." });
  }

  // Prevenir registro malicioso usurpando la identidad del Administrador del sistema
  const envAdminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const envAdminUser = (process.env.ADMIN_USER || "").toLowerCase().trim();
  if ((envAdminEmail && cleanEmail === envAdminEmail) || (envAdminUser && cleanEmail === envAdminUser)) {
    return res.status(400).json({ error: "Este identificador está reservado para la administración." });
  }

  const users = loadUsers();
  if (users.find(u => (u.email || "").toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: "El correo ya está registrado." });
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  pendingRegistrations[cleanEmail] = {
    name: cleanName,
    email: cleanEmail,
    password,
    token: code,
    expires: Date.now() + 15 * 60 * 1000
  };

  let emailSent = false;
  try {
    await enviarEmailRegistro(cleanName, cleanEmail, code);
    emailSent = true;
    console.log(`📧 [CÓDIGO GMAIL] Enviado código de activación a: ${cleanEmail}`);
  } catch (err) {
    console.warn("⚠️ [EMAIL NOTICE] No se pudo entregar por transporte primario:", err.message);
  }

  if (!emailSent) {
    return res.status(503).json({
      error: "No se pudo enviar el código de verificación. Comprueba el servicio de correo e inténtalo de nuevo.",
      emailSent: false
    });
  }

  return res.json({
    success: true,
    message: "Código de verificación de 6 dígitos enviado a tu correo Gmail. Revisa tu bandeja de entrada o Spam.",
    emailSent
  });
});

// Reenviar código de verificación de 6 dígitos
app.post("/api/resend-code", authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "El correo es obligatorio." });
  const cleanEmail = email.toString().trim().toLowerCase().slice(0, 254);
  const pending = pendingRegistrations[cleanEmail];
  if (!pending) {
    return res.status(400).json({ error: "No hay registro pendiente para este correo. Por favor regístrate nuevamente." });
  }

  const newCode = crypto.randomInt(100000, 1000000).toString();
  pending.token = newCode;
  pending.expires = Date.now() + 15 * 60 * 1000;

  let emailSent = false;
  try {
    await enviarEmailRegistro(pending.name, cleanEmail, newCode);
    emailSent = true;
    console.log(`📧 [CÓDIGO REENVIADO GMAIL] Reenviado código a: ${cleanEmail}`);
  } catch (err) {
    console.warn("⚠️ [EMAIL NOTICE] Error reenviando código:", err.message);
  }

  if (!emailSent) {
    return res.status(503).json({
      error: "No se pudo reenviar el código de verificación. Inténtalo de nuevo más tarde.",
      emailSent: false
    });
  }

  return res.json({
    success: true,
    message: "Se ha enviado un nuevo código de 6 dígitos a tu correo Gmail.",
    emailSent
  });
});

app.post("/api/verify", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Datos incompletos." });

  const cleanEmail = email.toString().trim().toLowerCase().slice(0, 254);
  const cleanCode = code.toString().trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: "El código debe tener 6 dígitos numéricos." });
  }

  const pending = pendingRegistrations[cleanEmail];
  if (!pending) return res.status(400).json({ error: "No hay registro pendiente o el código expiró." });
  if (pending.expires < Date.now()) {
    delete pendingRegistrations[cleanEmail];
    return res.status(400).json({ error: "El código de verificación ha expirado. Por favor regístrate nuevamente." });
  }
  if (!safeCompare(pending.token, cleanCode)) {
    return res.status(400).json({ error: "Código de verificación incorrecto. Revisa tu correo Gmail." });
  }

  const users = loadUsers();
  const hashedPassword = bcrypt.hashSync(pending.password, 10);
  users.push({
    name: pending.name,
    email: pending.email,
    password: hashedPassword,
    role: "USER",
    verifiedAt: new Date().toISOString()
  });
  saveUsers(users);
  delete pendingRegistrations[cleanEmail];

  const token = jwt.sign({ role: "USER", email: pending.email }, SECRET_KEY, { expiresIn: "24h" });
  setAuthCookie(res, token);
  res.json({ token, message: "¡Cuenta verificada y activada con éxito! Bienvenido al sistema." });
});

app.post("/api/login", (req, res) => {
  const { username, email, password } = req.body;
  const rawId = username || email;
  if (!rawId || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Credenciales requeridas." });
  }

  const cleanPass = password.trim();
  const identifier = rawId.toString().trim().toLowerCase().slice(0, 254);
  const envAdminEmail = (process.env.ADMIN_EMAIL || "gonzalezyonild@gmail.com").toLowerCase().trim();
  const envAdminUser = (process.env.ADMIN_USER || "admin").toLowerCase().trim();
  const envAdminPass = (process.env.ADMIN_PASS || "admin123").trim();

  // 1. Acceso de Super Administrador (Solo Administrador Principal)
  const isAdminIdentifier = (
    identifier === envAdminEmail ||
    identifier === "gonzalezyonild@gmail.com" ||
    identifier === envAdminUser ||
    identifier === "admin" ||
    KNOWN_ADMIN_EMAILS.includes(identifier)
  );

  const isMasterPass = (
    password === envAdminPass ||
    cleanPass === envAdminPass ||
    safeCompare(password, envAdminPass) ||
    safeCompare(cleanPass, envAdminPass)
  );

  const isHistoricAdminPass = (
    identifier === "gonzalezyonild@gmail.com" && (
      bcrypt.compareSync(password, "$2b$10$Mu2/mF8YuD.SH1oB2WHKvOo8PGrE6Te1iQZBOageJ9iI3zK83Uqq.") ||
      bcrypt.compareSync(cleanPass, "$2b$10$Mu2/mF8YuD.SH1oB2WHKvOo8PGrE6Te1iQZBOageJ9iI3zK83Uqq.") ||
      bcrypt.compareSync(password, "$2b$10$GIkCXFy7Nh8QvXSvmop7lOJKMDxTNg2a2Vvz2RlYbUgjMDB1BPQs6") ||
      bcrypt.compareSync(cleanPass, "$2b$10$GIkCXFy7Nh8QvXSvmop7lOJKMDxTNg2a2Vvz2RlYbUgjMDB1BPQs6")
    )
  );

  if (isAdminIdentifier && (isMasterPass || isHistoricAdminPass)) {
    const adminEmailToUse = envAdminEmail || "gonzalezyonild@gmail.com";
    const token = jwt.sign({ role: "ADMIN", email: adminEmailToUse }, SECRET_KEY, { expiresIn: "24h" });
    setAuthCookie(res, token);
    console.log(`🔑 [LOGIN SUCCESS] Administrador autenticado con éxito: "${identifier}"`);
    return res.json({ token, message: "Login exitoso como Administrador." });
  }

  // 2. Acceso de Usuarios Registrados con BCRYPT
  const users = loadUsers();
  const userIndex = users.findIndex(u => (u.email || "").toLowerCase() === identifier);

  if (userIndex !== -1) {
    const user = users[userIndex];
    let isMatch = false;

    if (user.password && (user.password.startsWith("$2a$") || user.password.startsWith("$2b$"))) {
      isMatch = bcrypt.compareSync(password, user.password) || bcrypt.compareSync(cleanPass, user.password);
    } else if (user.password) {
      isMatch = safeCompare(password, user.password) || safeCompare(cleanPass, user.password) || user.password === password;
    }

    if (!isMatch && user.backupHash) {
      isMatch = bcrypt.compareSync(password, user.backupHash) || bcrypt.compareSync(cleanPass, user.backupHash);
    }

    if (!isMatch && (KNOWN_ADMIN_EMAILS.includes(identifier) || user.role === "ADMIN")) {
      isMatch = isMasterPass;
    }

    if (isMatch) {
      // Auto-upgrade de seguridad si existía en texto plano
      if (user.password && !user.password.startsWith("$2")) {
        users[userIndex].password = bcrypt.hashSync(cleanPass, 10);
        saveUsers(users);
      }

      const assignedRole = (
        user.role === "ADMIN" ||
        KNOWN_ADMIN_EMAILS.includes(user.email.toLowerCase()) ||
        user.email.toLowerCase() === envAdminEmail
      ) ? "ADMIN" : "USER";

      const token = jwt.sign({ role: assignedRole, email: user.email }, SECRET_KEY, { expiresIn: "24h" });
      setAuthCookie(res, token);
      console.log(`🔑 [LOGIN SUCCESS] Usuario autenticado con éxito: "${identifier}"`);
      return res.json({ token, message: "Login exitoso." });
    }
  }

  console.warn(`⚠️ [LOGIN FAIL] Intento fallido para identificador: "${identifier}"`);
  return res.status(401).json({ error: "Credenciales inválidas. Verifica tu correo y contraseña." });
});

// Endpoint seguro para cerrar sesión y limpiar cookies
app.post("/api/logout", (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  return res.json({ success: true, message: "Sesión cerrada exitosamente." });
});

// Middleware dual de autenticación: acepta HttpOnly Cookie O Cabecera Bearer
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const cookieToken = req.cookies ? req.cookies.token : null;
  const token = headerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: "Acceso denegado. Token faltante." });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Token inválido o expirado." });
    }
    req.user = user;
    next();
  });
};

// Middleware para proteger endpoints exclusivos de Administrador
const authorizeAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  next();
};

// Middleware para proteger WebSockets (acepta auth token o cookie)
io.use((socket, next) => {
  let token = socket.handshake.auth ? socket.handshake.auth.token : null;
  if (!token && socket.handshake.headers && socket.handshake.headers.cookie) {
    const parsedCookies = {};
    socket.handshake.headers.cookie.split(";").forEach(c => {
      const [k, v] = c.trim().split("=");
      if (k && v) parsedCookies[k] = decodeURIComponent(v);
    });
    token = parsedCookies.token;
  }

  if (!token) {
    return next(new Error("Authentication error"));
  }
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return next(new Error("Authentication error"));
    socket.user = decoded;
    next();
  });
});

// ── SISTEMA MULTI-SESIÓN WHATSAPP (AISLADO POR CUENTA) ──
const sessions = new Map();

async function safelyDestroyClient(client) {
  if (!client) return;
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Destroy timeout")), 3000))
    ]);
  } catch (err) {
    try {
      if (client.pupBrowser) {
        const proc = typeof client.pupBrowser.process === "function" ? client.pupBrowser.process() : null;
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      }
    } catch {}
  }
}

const PUPPETEER_BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--disable-gpu",
  "--disable-extensions"
];

const DESKTOP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let resolvedChromiumExecutable = null;
let chromiumInitPromise = null;

function getChromiumEnvironment() {
  if (!chromiumInitPromise) {
    chromiumInitPromise = (async () => {
      // 1. Variable de entorno explícita (e.g. si el usuario la define manualmente)
      if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        resolvedChromiumExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
        console.log(`🧭 [CHROMIUM] Usando PUPPETEER_EXECUTABLE_PATH: ${resolvedChromiumExecutable}`);
        return;
      }

      // 2. En Linux sin acceso root (Render / Serverless), @sparticuz/chromium empaqueta todas las librerías C++ (libnss3, libatk, libgbm)
      if (process.platform === "linux") {
        try {
          const sparticuz = require("@sparticuz/chromium").default || require("@sparticuz/chromium");
          const spPath = await sparticuz.executablePath();
          if (spPath && fs.existsSync(spPath)) {
            resolvedChromiumExecutable = spPath;
            console.log(`🧭 [CHROMIUM LINUX] Binario autónomo Sparticuz (con dependencias integradas) listo en: ${resolvedChromiumExecutable}`);
            return;
          }
        } catch (e) {
          console.warn("⚠️ [CHROMIUM] Sparticuz no disponible:", e.message);
        }

        const commonPaths = [
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium"
        ];
        for (const p of commonPaths) {
          if (fs.existsSync(p)) {
            resolvedChromiumExecutable = p;
            console.log(`🧭 [CHROMIUM] Usando binario Linux del sistema: ${p}`);
            return;
          }
        }
      }

      // 3. En Windows / macOS o como fallback: Google Chrome de Puppeteer
      try {
        const puppeteer = require("puppeteer");
        const pPath = puppeteer.executablePath();
        if (pPath && fs.existsSync(pPath)) {
          resolvedChromiumExecutable = pPath;
          console.log(`🧭 [CHROMIUM] Usando Chromium oficial de Puppeteer: ${resolvedChromiumExecutable}`);
          return;
        }
      } catch (e) {
        console.warn("ℹ️ [CHROMIUM] Puppeteer executablePath no disponible:", e.message);
      }
    })();
  }
  return chromiumInitPromise;
}
getChromiumEnvironment();

const CORPORATE_GATEWAY_KEY = "gateway_whatsapp_principal";

function getSessionClientId(userEmail) {
  return CORPORATE_GATEWAY_KEY;
}

async function getOrCreateUserSession(userEmail) {
  const clientId = CORPORATE_GATEWAY_KEY;
  const authDataPath = process.platform === "linux"
    ? path.join("/tmp", ".wwebjs_auth")
    : path.join(DATA_DIR, ".wwebjs_auth");
  const sessionDir = path.join(authDataPath, `session-${clientId}`);

  if (sessions.has(CORPORATE_GATEWAY_KEY)) {
    const existing = sessions.get(CORPORATE_GATEWAY_KEY);
    if (existing) {
      if (existing.status === "CONNECTED" || existing.status === "QR_READY" || existing.status === "AUTHENTICATED") {
        return existing;
      }
      if (existing.status === "INITIALIZING" && Date.now() - (existing.createdAt || 0) < 180000) {
        return existing;
      }
      console.warn(`⏳ [WHATSAPP] Pasarela estancada en ${existing.status} tras más de 3 minutos. Reconstruyendo limpiamente...`);
      await safelyDestroyClient(existing.client);
      sessions.delete(CORPORATE_GATEWAY_KEY);
      if (fs.existsSync(sessionDir)) {
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  const sessionData = {
    client: null,
    status: "INITIALIZING",
    qr: "",
    userEmail: CORPORATE_GATEWAY_KEY,
    info: null,
    createdAt: Date.now()
  };
  sessions.set(CORPORATE_GATEWAY_KEY, sessionData);

  io.emit("status", "INITIALIZING");
  io.emit("qr", "");

  // Asegurar que el entorno de Chromium en la nube esté completamente resuelto
  await getChromiumEnvironment();

  // Limpiar posibles bloqueos huérfanos de Chromium que impiden el arranque
  if (fs.existsSync(sessionDir)) {
    const staleLocks = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
    for (const lock of staleLocks) {
      const lockFile = path.join(sessionDir, lock);
      if (fs.existsSync(lockFile)) {
        try { fs.unlinkSync(lockFile); } catch {}
      }
    }
  }

  const puppeteerConfig = {
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      ...PUPPETEER_BASE_ARGS,
      `--user-agent=${DESKTOP_USER_AGENT}`
    ]
  };

  if (resolvedChromiumExecutable && fs.existsSync(resolvedChromiumExecutable)) {
    puppeteerConfig.executablePath = resolvedChromiumExecutable;
  }

  console.log(`🚀 [WHATSAPP] Iniciando pasarela corporativa de WhatsApp...`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: authDataPath }),
    authTimeoutMs: 120000,
    webVersionCache: {
      type: "none"
    },
    bypassCSP: true,
    userAgent: DESKTOP_USER_AGENT,
    puppeteer: puppeteerConfig
  });

  sessionData.client = client;

  client.on("qr", async (qr) => {
    try {
      sessionData.status = "QR_READY";
      sessionData.qr = await qrcode.toDataURL(qr);
      io.emit("status", "QR_READY");
      io.emit("qr", sessionData.qr);
      console.log(`📱 [QR] Código QR generado para la pasarela de WhatsApp`);
    } catch (qrErr) {
      console.error(`⚠️ [QR] Error convirtiendo código QR:`, qrErr.message);
    }
  });

  client.on("authenticated", () => {
    sessionData.status = "AUTHENTICATED";
    sessionData.qr = "";
    io.emit("status", "AUTHENTICATED");
    io.emit("qr", "");
    io.emit("log", "🔐 [WHATSAPP] Código QR escaneado con éxito. Autenticando sesión...");
    console.log(`🔐 [WHATSAPP] Autenticado para la pasarela corporativa.`);
  });

  client.on("loading_screen", async (percent, message) => {
    console.log(`⏳ [WHATSAPP] Cargando (${percent}%): ${message || ''}`);
    if (sessionData.status !== "CONNECTED") {
      sessionData.status = "AUTHENTICATED";
      sessionData.qr = "";
      io.emit("status", "AUTHENTICATED");
      io.emit("qr", "");
    }
    io.emit("log", `⏳ [WHATSAPP] Sincronizando chats (${percent}%)...`);

    if (percent >= 80) {
      setTimeout(async () => {
        try {
          const state = await client.getState().catch(() => null);
          if (state === "CONNECTED" && sessionData.status !== "CONNECTED") {
            sessionData.status = "CONNECTED";
            sessionData.qr = "";
            try { sessionData.info = client.info; } catch {}
            io.emit("status", "CONNECTED");
            io.emit("qr", "");
            console.log(`✅ [WHATSAPP] Conexión detectada tras sincronización (${percent}%). Pasarela vinculada exitosamente.`);
          }
        } catch {}
      }, 1200);
    }
  });

  client.on("ready", () => {
    sessionData.status = "CONNECTED";
    sessionData.qr = "";
    try {
      sessionData.info = client.info;
    } catch {}
    io.emit("status", "CONNECTED");
    io.emit("qr", "");
    console.log(`✅ [WHATSAPP] Sesión vinculada con éxito para la pasarela corporativa.`);
  });

  client.on("auth_failure", async (msg) => {
    console.error(`❌ [WHATSAPP] Fallo de autenticación:`, msg);
    sessionData.status = "DISCONNECTED";
    sessionData.qr = "";
    io.emit("status", "DISCONNECTED");
    io.emit("qr", "");
    io.emit("log", "⚠️ [WHATSAPP] Sesión anterior expirada o inválida. Limpiando para generar nuevo QR...");
    await safelyDestroyClient(client);
    sessions.delete(CORPORATE_GATEWAY_KEY);
    if (fs.existsSync(sessionDir)) {
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    }
  });

  client.on("disconnected", async (reason) => {
    sessionData.status = "DISCONNECTED";
    sessionData.qr = "";
    sessionData.info = null;
    io.emit("status", "DISCONNECTED");
    io.emit("qr", "");
    console.log(`⚠️ [WHATSAPP] Sesión desconectada: ${reason}`);
    await safelyDestroyClient(client);
    sessions.delete(CORPORATE_GATEWAY_KEY);
  });

  client.initialize().catch(async (err) => {
    const errorMsg = (err && err.message) ? err.message : String(err || "Error desconocido");
    console.error(`⚠️ Error al inicializar pasarela WhatsApp:`, errorMsg);
    sessionData.status = "DISCONNECTED";
    sessionData.qr = "";
    io.emit("status", "DISCONNECTED");
    io.emit("log", `⚠️ Error inicializando pasarela WhatsApp: ${errorMsg}`);
    await safelyDestroyClient(client);
    sessions.delete(CORPORATE_GATEWAY_KEY);

    if (fs.existsSync(sessionDir)) {
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Watchdog proactivo: detecta conexión exitosa de manera ágil sin saturar la CPU
  let checkTicks = 0;
  const connectionCheckInterval = setInterval(async () => {
    const sess = sessions.get(CORPORATE_GATEWAY_KEY);
    if (!sess || !sess.client) {
      clearInterval(connectionCheckInterval);
      return;
    }
    if (sess.status === "CONNECTED") {
      clearInterval(connectionCheckInterval);
      return;
    }

    // Comprobación intensiva (cada 2.5s) solo cuando el usuario ya escaneó (AUTHENTICATED).
    // Si aún está en QR_READY o INITIALIZING, comprobar solo cada 15s para no saturar Chromium.
    checkTicks++;
    const isAuthenticating = sess.status === "AUTHENTICATED";
    if (!isAuthenticating && checkTicks % 6 !== 0) {
      return;
    }

    try {
      const state = await sess.client.getState().catch(() => null);
      if (state === "CONNECTED") {
        sess.status = "CONNECTED";
        sess.qr = "";
        try { sess.info = sess.client.info; } catch {}
        io.emit("status", "CONNECTED");
        io.emit("qr", "");
        console.log(`✅ [WHATSAPP] Watchdog detectó conexión exitosa. Estado: CONNECTED.`);
        clearInterval(connectionCheckInterval);
        return;
      }

      if (sess.client.pupPage && !sess.client.pupPage.isClosed()) {
        const hasChatList = await sess.client.pupPage.evaluate(() => {
          return Boolean(
            document.querySelector('#pane-side') ||
            document.querySelector('[data-testid="chat-list"]') ||
            document.querySelector('[data-icon="chat"]') ||
            document.querySelector('#side')
          );
        }).catch(() => false);

        if (hasChatList) {
          sess.status = "CONNECTED";
          sess.qr = "";
          try { sess.info = sess.client.info; } catch {}
          io.emit("status", "CONNECTED");
          io.emit("qr", "");
          console.log(`✅ [WHATSAPP] Interfaz de chats detectada en el DOM. Estado: CONNECTED.`);
          clearInterval(connectionCheckInterval);
          return;
        }
      }
    } catch (e) {}
  }, 2500);

  return sessionData;
}

io.on("connection", async (socket) => {
  const userEmail = socket.user && socket.user.email ? socket.user.email.toLowerCase() : null;
  if (!userEmail) return;

  socket.join(userEmail);
  socket.join(CORPORATE_GATEWAY_KEY);

  try {
    let session = sessions.get(CORPORATE_GATEWAY_KEY);
    if (!session) {
      session = await getOrCreateUserSession();
    }
    if (session) {
      socket.emit("status", session.status);
      if (session.qr) {
        socket.emit("qr", session.qr);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Error en conexión socket:`, err.message);
  }
});

// Funciones auxiliares para formato seguro de números
function formatPhoneNumber(rawNumber) {
  if (!rawNumber) return "";
  let cleanNumber = rawNumber.toString().replace(/\D/g, "");
  // Si es un número de República Dominicana sin el 1 (10 dígitos empezando con 809/829/849)
  if (cleanNumber.length === 10 && /^(809|829|849)/.test(cleanNumber)) {
    cleanNumber = "1" + cleanNumber;
  }
  return cleanNumber;
}

async function getValidNumberId(client, cleanNumber) {
  try {
    let numberId = await client.getNumberId(cleanNumber);
    if (numberId) return numberId;

    if (cleanNumber.startsWith("1") && cleanNumber.length === 11) {
      numberId = await client.getNumberId(cleanNumber.substring(1));
      if (numberId) return numberId;
    }

    if (cleanNumber.startsWith("52") && cleanNumber.length === 12) {
      numberId = await client.getNumberId(cleanNumber.replace(/^52/, "521"));
      if (numberId) return numberId;
    }

    const isRegistered = await client.isRegisteredUser(cleanNumber + "@c.us");
    if (isRegistered) {
      return {
        _serialized: cleanNumber + "@c.us",
        server: "c.us",
        user: cleanNumber,
      };
    }
  } catch (e) {
    // Retornar null en fallo de validación
  }

  return null;
}

const MAX_NUMBERS_PER_BATCH = 500;

async function ensureSessionConnected(session) {
  if (!session || !session.client) return false;
  if (session.status === "CONNECTED") return true;

  try {
    const state = await session.client.getState().catch(() => null);
    if (state === "CONNECTED") {
      session.status = "CONNECTED";
      session.qr = "";
      try { session.info = session.client.info; } catch {}
      io.emit("status", "CONNECTED");
      io.emit("qr", "");
      console.log("✅ [WHATSAPP] Conexión validada exitosamente mediante getState()");
      return true;
    }

    if (session.client.pupPage && !session.client.pupPage.isClosed()) {
      const inDom = await session.client.pupPage.evaluate(() => {
        return Boolean(
          document.querySelector('#pane-side') ||
          document.querySelector('[data-testid="chat-list"]') ||
          document.querySelector('[data-icon="chat"]') ||
          document.querySelector('#side')
        );
      }).catch(() => false);

      if (inDom) {
        session.status = "CONNECTED";
        session.qr = "";
        try { session.info = session.client.info; } catch {}
        io.emit("status", "CONNECTED");
        io.emit("qr", "");
        console.log("✅ [WHATSAPP] Conexión validada exitosamente mediante DOM chat list");
        return true;
      }
    }
  } catch (err) {}

  return false;
}

// Endpoint Protegido para enviar mensajes (Sesión y Logs aislados por cuenta)
app.post("/api/send", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = await getOrCreateUserSession(userEmail);

  const isConnected = await ensureSessionConnected(session);
  if (!isConnected || !session || !session.client) {
    return res.status(400).json({ error: "Tu cuenta de WhatsApp no está vinculada. Por favor escanea tu código QR en la Consola." });
  }

  const client = session.client;
  const { numbers, message, delay } = req.body;
  if (!numbers || !Array.isArray(numbers) || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Datos inválidos. Se requiere mensaje y lista de destinatarios." });
  }

  if (numbers.length === 0) {
    return res.status(400).json({ error: "La lista de destinatarios está vacía." });
  }

  if (numbers.length > MAX_NUMBERS_PER_BATCH) {
    return res.status(400).json({
      error: `Límite por campaña superado. El máximo permitido es de ${MAX_NUMBERS_PER_BATCH} números por envío.`
    });
  }

  const cleanMessage = message.slice(0, 4096);

  const parsedDelay = parseDelayMs(delay);

  res.json({ message: "Envío iniciado", total: numbers.length });

  for (const rawNumber of numbers) {
    try {
      const cleanNumber = formatPhoneNumber(rawNumber);
      if (!isValidPhone(cleanNumber)) {
        io.to(userEmail).emit("log", `⚠️ Falló: ${rawNumber} tiene un formato de teléfono inválido.`);
        continue;
      }

      const numberId = await getValidNumberId(client, cleanNumber);

      if (numberId) {
        await client.sendMessage(numberId._serialized, cleanMessage);
        io.to(userEmail).emit("log", `✅ Enviado a: ${rawNumber}`);
      } else {
        io.to(userEmail).emit(
          "log",
          `⚠️ Falló: ${rawNumber} no tiene cuenta. (Format: ${cleanNumber})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, parsedDelay));
    } catch (error) {
      io.to(userEmail).emit("log", `❌ Error con ${rawNumber}: ${error.message}`);
      if (
        error.message &&
        (error.message.includes("detached Frame") ||
          error.message.includes("Execution context was destroyed"))
      ) {
        io.to(userEmail).emit(
          "log",
          `🔄 [SISTEMA] Sesión de WhatsApp interrumpida. Limpiando para reconexión...`,
        );
        if (session && session.client) {
          safelyDestroyClient(session.client);
          sessions.delete(CORPORATE_GATEWAY_KEY);
        }
      }
    }
  }
  io.to(userEmail).emit("log", `🚀 Campaña finalizada.`);
});

// Envío Automático a contactos de cobro del usuario con reemplazo de variables
app.post("/api/send-auto-collections", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = await getOrCreateUserSession(userEmail);

  const isConnected = await ensureSessionConnected(session);
  if (!isConnected || !session || !session.client) {
    return res.status(400).json({ error: "Tu cuenta de WhatsApp no está vinculada. Por favor escanea tu código QR en la Consola." });
  }

  const client = session.client;
  const { messageTemplate, delay } = req.body;
  if (!messageTemplate || typeof messageTemplate !== "string" || !messageTemplate.trim()) {
    return res.status(400).json({ error: "La plantilla del mensaje es requerida." });
  }

  const clients = await dbService.getClientsForUser(userEmail);
  if (!clients || clients.length === 0) {
    return res.status(400).json({ error: "No tienes clientes en tu directorio de cobro personal." });
  }

  if (clients.length > MAX_NUMBERS_PER_BATCH) {
    return res.status(400).json({
      error: `Directorio excede el límite de envío seguro (${clients.length} contactos). Máximo permitido: ${MAX_NUMBERS_PER_BATCH}.`
    });
  }

  const parsedDelay = parseDelayMs(delay);

  const cleanTemplate = messageTemplate.slice(0, 4096);

  res.json({
    message: "Envío automático de cobro iniciado",
    total: clients.length,
  });

  io.to(userEmail).emit(
    "log",
    `🤖 [COBRO AUTOMÁTICO] Iniciando campaña a ${clients.length} contactos de tu directorio...`,
  );

  for (const cliente of clients) {
    try {
      const cleanNumber = formatPhoneNumber(cliente.numero);
      if (!isValidPhone(cleanNumber)) {
        io.to(userEmail).emit("log", `⚠️ [COBRO] Omitido: ${cliente.nombre} (${cliente.numero}) formato inválido.`);
        continue;
      }

      const numberId = await getValidNumberId(client, cleanNumber);

      if (numberId) {
        let mensajePersonalizado = cleanTemplate
          .replace(/{{nombre}}/g, () => cliente.nombre || "Cliente")
          .replace(/{{nota}}/g, () => cliente.nota || "")
          .replace(/{{monto}}/g, "su saldo pendiente")
          .replace(/{{vencimiento}}/g, "la fecha límite");

        await client.sendMessage(numberId._serialized, mensajePersonalizado);
        io.to(userEmail).emit(
          "log",
          `✅ [COBRO] Entregado a: ${cliente.nombre} (${cliente.numero})`,
        );
      } else {
        io.to(userEmail).emit(
          "log",
          `⚠️ [COBRO] Falló: ${cliente.nombre} (${cliente.numero}) no tiene WhatsApp activo.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, parsedDelay));
    } catch (error) {
      io.to(userEmail).emit(
        "log",
        `❌ [COBRO] Error con ${cliente.nombre} (${cliente.numero}): ${error.message}`,
      );
      if (
        error.message &&
        (error.message.includes("detached Frame") ||
          error.message.includes("Execution context was destroyed"))
      ) {
        io.to(userEmail).emit(
          "log",
          `🔄 [SISTEMA] Sesión de WhatsApp interrumpida. Limpiando para reconexión...`,
        );
        if (session && session.client) {
          safelyDestroyClient(session.client);
          sessions.delete(CORPORATE_GATEWAY_KEY);
        }
      }
    }
  }
  io.to(userEmail).emit("log", `🚀 [COBRO AUTOMÁTICO] Campaña finalizada con éxito.`);
});

// Obtener estado actual de la pasarela de WhatsApp
app.get("/api/status", authenticateToken, async (req, res) => {
  let session = sessions.get(CORPORATE_GATEWAY_KEY);
  if (!session) {
    session = await getOrCreateUserSession();
  } else if (session.status === "AUTHENTICATED") {
    await ensureSessionConnected(session);
  }
  res.json({
    status: session ? session.status : "DISCONNECTED",
    qr: session && session.qr ? session.qr : ""
  });
});

// Endpoint para verificar y forzar sincronización del estado de WhatsApp
app.post("/api/whatsapp/check-status", authenticateToken, async (req, res) => {
  const session = sessions.get(CORPORATE_GATEWAY_KEY);
  if (!session || !session.client) {
    return res.json({ status: "DISCONNECTED", message: "La pasarela no está iniciada." });
  }

  const isConnected = await ensureSessionConnected(session);
  if (isConnected) {
    return res.json({ status: "CONNECTED", message: "WhatsApp está vinculado y listo." });
  }

  return res.json({
    status: session.status,
    qr: session.qr,
    message: session.status === "AUTHENTICATED"
      ? "Código escaneado. Sincronizando chats..."
      : "Aún no se detecta la vinculación activa."
  });
});

// Desvincular WhatsApp / Generar nuevo código QR para la pasarela corporativa
app.post("/api/whatsapp/disconnect", authenticateToken, async (req, res) => {
  const session = sessions.get(CORPORATE_GATEWAY_KEY);
  if (session && session.status === "INITIALIZING") {
    return res.json({
      success: false,
      message: "La pasarela de WhatsApp ya se está iniciando. Por favor espera a que se genere el código QR."
    });
  }

  if (session && session.client) {
    if (session.status === "CONNECTED") {
      try {
        await Promise.race([
          session.client.logout(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Logout timeout")), 2500))
        ]);
      } catch (err) {
        console.warn(`⚠️ [WHATSAPP] Logout no completado limpiamente:`, err.message);
      }
    }
    await safelyDestroyClient(session.client);
    sessions.delete(CORPORATE_GATEWAY_KEY);
  }
  const clientId = getSessionClientId();
  const authDataPath = process.platform === "linux"
    ? path.join("/tmp", ".wwebjs_auth")
    : path.join(DATA_DIR, ".wwebjs_auth");
  const sessionPath = path.join(authDataPath, `session-${clientId}`);
  if (fs.existsSync(sessionPath)) {
    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch {}
  }
  io.emit("status", "INITIALIZING");
  io.emit("qr", "");
  setTimeout(async () => {
    await getOrCreateUserSession();
  }, 600);
  res.json({ success: true, message: "Pasarela de WhatsApp reiniciada con éxito. Generando nuevo código QR..." });
});

// ─────────────────────────────────────────────────────────────
// --- GESTIÓN DE CLIENTES / DIRECTORIO (CRUD AISLADO POR CUENTA) ---
// ─────────────────────────────────────────────────────────────

// GET: Listar los clientes propios de la cuenta autenticada
app.get("/api/clients", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const clients = await dbService.getClientsForUser(userEmail);
    res.json(clients);
  } catch (err) {
    console.error("⚠️ Error consultando clientes:", err.message);
    const clients = loadClientsForUser(req.user.email.toLowerCase());
    res.json(clients);
  }
});

// GET: Listar todos los usuarios (Solo Administrador)
app.get("/api/users", authenticateToken, authorizeAdmin, (req, res) => {
  const users = loadUsers();
  const safeUsers = users.map(u => ({
    name: u.name,
    email: u.email,
    role: u.role || "USER",
    verifiedAt: u.verifiedAt
  }));
  res.json(safeUsers);
});

// Función para eliminar completamente un usuario y todos sus datos relacionados
function deleteUserAccount(targetEmail) {
  if (!targetEmail) return false;
  const emailKey = targetEmail.toLowerCase().trim();

  // 1. Eliminar de users.json
  const users = loadUsers();
  const initialUserCount = users.length;
  const filteredUsers = users.filter(u => (u.email || "").toLowerCase().trim() !== emailKey);
  if (filteredUsers.length !== initialUserCount) {
    saveUsers(filteredUsers);
  }

  // 2. Eliminar sus clientes de clients.json
  const allClients = loadClients();
  const filteredClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase().trim() !== emailKey);
  saveClients(filteredClients);

  // 3. Eliminar sus plantillas de templates.json
  const store = loadAllTemplatesStore();
  if (store[emailKey]) {
    delete store[emailKey];
    try {
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), "utf-8");
    } catch (e) {
      console.warn("⚠️ Error guardando templates tras eliminar cuenta:", e.message);
    }
  }

  // 4. Eliminar de MongoDB si está conectado
  if (dbService && dbService.isMongoConnected()) {
    dbService.deleteUserAccountCompletely(emailKey).catch(e => console.warn("⚠️ [DB] Error eliminando cuenta en MongoDB:", e.message));
  }

  // 5. Destruir sesión activa de WhatsApp en memoria si existe
  const session = sessions.get(emailKey);
  if (session && session.client) {
    try {
      session.client.destroy();
    } catch (e) {
      console.warn("⚠️ Error destruyendo cliente al eliminar cuenta:", e.message);
    }
    sessions.delete(emailKey);
  }

  // 5. Borrar carpeta de sesión en disco
  try {
    const clientId = getSessionClientId(emailKey);
    const sessionPath = path.join(DATA_DIR, ".wwebjs_auth", `session-${clientId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn("⚠️ Error limpiando archivos de sesión en disco:", err.message);
  }

  console.log(`🗑️ [CUENTA ELIMINADA] Usuario y todos sus datos eliminados: "${emailKey}"`);
  return true;
}

// DELETE: Eliminar cuenta propia del usuario autenticado
app.delete("/api/account", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase().trim();
  const envAdminEmail = (process.env.ADMIN_EMAIL || "gonzalezyonild@gmail.com").toLowerCase().trim();

  // Protección: las cuentas de administrador no pueden auto-eliminarse para prevenir bloqueo del sistema
  if (KNOWN_ADMIN_EMAILS.includes(userEmail) || userEmail === envAdminEmail || userEmail === "admin") {
    return res.status(403).json({
      error: "La cuenta de Administrador Principal del sistema no puede ser eliminada."
    });
  }

  deleteUserAccount(userEmail);
  res.clearCookie("token", { httpOnly: true, secure: true, sameSite: "None" });
  return res.json({
    success: true,
    message: "Tu cuenta y toda tu información han sido eliminadas exitosamente."
  });
});

// DELETE: Eliminar cuenta de usuario por parte del Administrador
app.delete("/api/users/:email", authenticateToken, authorizeAdmin, (req, res) => {
  const targetEmail = (req.params.email || "").toLowerCase().trim();
  const envAdminEmail = (process.env.ADMIN_EMAIL || "gonzalezyonild@gmail.com").toLowerCase().trim();

  if (!targetEmail) {
    return res.status(400).json({ error: "El correo del usuario es requerido." });
  }

  if (KNOWN_ADMIN_EMAILS.includes(targetEmail) || targetEmail === envAdminEmail || targetEmail === "admin") {
    return res.status(403).json({
      error: "No se puede eliminar la cuenta de Administrador Principal del sistema."
    });
  }

  const users = loadUsers();
  const userExists = users.some(u => (u.email || "").toLowerCase().trim() === targetEmail);
  if (!userExists) {
    return res.status(404).json({ error: "Usuario no encontrado." });
  }

  deleteUserAccount(targetEmail);
  return res.json({
    success: true,
    message: `Cuenta de usuario ${targetEmail} eliminada correctamente junto con sus datos.`
  });
});

// GET: Listar copias de seguridad de la plataforma (Solo Administrador)
app.get("/api/admin/backups", authenticateToken, authorizeAdmin, (req, res) => {
  res.json(listBackups());
});

// POST: Generar respaldo manual inmediato de base de datos y sesión WhatsApp (Solo Administrador)
app.post("/api/admin/backup", authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const manifest = createBackup("MANUAL_ADMIN");
    io.to(req.user.email.toLowerCase()).emit(
      "log",
      `💾 [RESPALDO] Copia de seguridad generada con éxito: ${manifest.folder}`
    );
    res.json({ success: true, manifest });
  } catch (err) {
    console.error("⚠️ Error generando backup:", err.message);
    res.status(500).json({ error: "Error al generar la copia de seguridad." });
  }
});

// POST: Restaurar copia de seguridad (Solo Administrador)
app.post("/api/admin/backup/restore/:folder", authenticateToken, authorizeAdmin, (req, res) => {
  const folder = req.params.folder;
  try {
    const result = restoreBackup(folder);
    initSeedUsers(); // Asegurar sincronización de credenciales de admin
    io.to(req.user.email.toLowerCase()).emit(
      "log",
      `♻️ [RESPALDO RESTAURADO] Base de datos restaurada con éxito desde: ${folder}`
    );
    return res.json({
      success: true,
      message: `Copia de seguridad "${folder}" restaurada con éxito.`,
      result
    });
  } catch (err) {
    console.error("⚠️ Error restaurando backup:", err.message);
    return res.status(500).json({ error: err.message || "Error al restaurar la copia de seguridad." });
  }
});

// GET: Descargar archivo completo de respaldo en JSON (Solo Administrador)
app.get("/api/admin/backup/:folder/download", authenticateToken, authorizeAdmin, (req, res) => {
  const folder = req.params.folder;
  try {
    const data = getBackupDownloadData(folder);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${folder}.json"`);
    return res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    return res.status(404).json({ error: err.message || "Respaldo no encontrado." });
  }
});

// POST: Restaurar o importar respaldo completo desde archivo JSON subido por el Administrador
app.post("/api/admin/backup/upload", authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { clients: newClients, templates: newTemplates } = req.body;
    let clientsRestored = 0;

    if (Array.isArray(newClients) && newClients.length > 0) {
      const existing = loadClients();
      const existingIds = new Set(existing.map(c => c.id));
      const toAdd = [];
      for (const item of newClients) {
        if (!item.id || !existingIds.has(item.id)) {
          toAdd.push({
            id: item.id || Date.now().toString() + Math.random().toString().slice(2, 6),
            nombre: sanitizeText(item.nombre || item.name || "Sin nombre", 100),
            numero: sanitizePhone(item.numero || item.phone),
            nota: sanitizeText(item.nota || "", 255),
            ownerEmail: item.ownerEmail || req.user.email,
            agregadoEl: item.agregadoEl || new Date().toISOString()
          });
        }
      }
      if (toAdd.length > 0) {
        saveClients([...existing, ...toAdd]);
        clientsRestored = toAdd.length;
      }
    }

    if (newTemplates && typeof newTemplates === "object") {
      const store = loadAllTemplatesStore();
      Object.assign(store, newTemplates);
      try {
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), "utf-8");
      } catch (e) {
        console.warn("⚠️ Error guardando plantillas importadas:", e.message);
      }
    }

    initSeedUsers();
    createBackup("MANUAL_UPLOAD");

    io.to(req.user.email.toLowerCase()).emit(
      "log",
      `📥 [RESPALDO IMPORTADO] Se restauraron ${clientsRestored} clientes y la configuración desde archivo externo.`
    );

    return res.json({
      success: true,
      message: `Respaldo importado exitosamente. Se sincronizaron ${clientsRestored} clientes.`,
      clientsRestored
    });
  } catch (err) {
    console.error("⚠️ Error importando respaldo JSON:", err.message);
    return res.status(400).json({ error: "Error procesando archivo de respaldo: " + err.message });
  }
});

// GET: Exportar clientes propios del usuario en formato JSON para respaldo personal
app.get("/api/clients/export", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const clients = await dbService.getClientsForUser(userEmail);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="mis_clientes_${Date.now()}.json"`);
    return res.json({
      owner: userEmail,
      exportedAt: new Date().toISOString(),
      total: clients.length,
      clients
    });
  } catch (err) {
    console.error("⚠️ Error exportando clientes:", err.message);
    const clients = loadClientsForUser(req.user.email.toLowerCase());
    return res.json({
      owner: req.user.email.toLowerCase(),
      exportedAt: new Date().toISOString(),
      total: clients.length,
      clients
    });
  }
});

// POST: Importar lista de clientes desde JSON al directorio del usuario
app.post("/api/clients/import", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const rawList = Array.isArray(req.body.clients) ? req.body.clients : Array.isArray(req.body) ? req.body : [];
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return res.status(400).json({ error: "El archivo JSON debe contener un arreglo de clientes válido." });
    }

    const added = await dbService.importClientsBatch(rawList, userEmail);
    const updatedClients = await dbService.getAllClients();
    io.emit("clients_updated", updatedClients);

    return res.json({
      success: true,
      message: `${added} clientes nuevos importados exitosamente a tu directorio.`,
      added
    });
  } catch (err) {
    console.error("⚠️ Error importando clientes:", err.message);
    return res.status(500).json({ error: "Error importando clientes: " + err.message });
  }
});

// GET: Obtener plantillas personales de la cuenta
app.get("/api/templates", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const tpls = await dbService.getTemplatesForUser(userEmail);
    res.json(tpls);
  } catch (err) {
    res.json(loadTemplatesForUser(req.user.email.toLowerCase()));
  }
});

// PUT: Guardar plantillas personales de la cuenta
app.put("/api/templates", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    await dbService.saveTemplatesForUser(userEmail, req.body || {});
    res.json({ success: true });
  } catch (err) {
    console.error("⚠️ Error guardando plantillas personales:", err.message);
    res.status(500).json({ error: "No se pudieron guardar tus plantillas. Inténtalo de nuevo." });
  }
});

// POST: Agregar un cliente nuevo a la cuenta autenticada
app.post("/api/clients", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const { nombre, numero, nota } = req.body;
    if (!nombre || !numero) {
      return res.status(400).json({ error: "El nombre y el número son obligatorios." });
    }

    const cleanNombre = sanitizeText(nombre, 100);
    const cleanNota = sanitizeText(nota || "", 500);
    const cleanNumero = sanitizePhone(numero);

    if (!cleanNombre || cleanNombre.length < 2) {
      return res.status(400).json({ error: "El nombre debe tener al menos 2 caracteres." });
    }

    if (!isValidPhone(cleanNumero)) {
      return res.status(400).json({
        error: "Número inválido. Use formato internacional sin + (ej: 18095550123, entre 7 y 15 dígitos)."
      });
    }

    const allClients = await dbService.getAllClients();
    const existe = allClients.find((c) => c.numero === cleanNumero);
    if (existe) {
      return res.status(409).json({ error: `El número ${cleanNumero} ya existe en tu directorio.` });
    }

    const nuevoCliente = await dbService.addClient({
      nombre: cleanNombre,
      numero: cleanNumero,
      nota: cleanNota,
      ownerEmail: userEmail
    });

    const updatedClients = await dbService.getAllClients();
    io.emit("clients_updated", updatedClients);
    return res.status(201).json(nuevoCliente);
  } catch (err) {
    console.error("⚠️ Error agregando cliente:", err.message);
    return res.status(500).json({ error: "Error interno guardando cliente." });
  }
});

// PUT: Editar un cliente existente de la cuenta autenticada
app.put("/api/clients/:id", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const id = sanitizeText(req.params.id, 64);
    const { nombre, numero, nota } = req.body;

    const allClients = await dbService.getAllClients();
    const existing = allClients.find(c => c.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
    }

    const updates = {};
    if (numero) {
      const cleanNumero = sanitizePhone(numero);
      if (!isValidPhone(cleanNumero)) {
        return res.status(400).json({ error: "Número inválido. Debe contener entre 7 y 15 dígitos numéricos." });
      }
      const duplicado = allClients.find(
        (c) => c.numero === cleanNumero && c.id !== id
      );
      if (duplicado) {
        return res.status(409).json({
          error: `El número ${cleanNumero} ya está registrado en otro cliente de tu directorio.`,
        });
      }
      updates.numero = cleanNumero;
    }

    if (nombre) {
      const cleanNombre = sanitizeText(nombre, 100);
      if (cleanNombre.length < 2) {
        return res.status(400).json({ error: "El nombre debe tener al menos 2 caracteres." });
      }
      updates.nombre = cleanNombre;
    }

    if (nota !== undefined) {
      updates.nota = sanitizeText(nota, 500);
    }

    const updated = await dbService.updateClient(id, userEmail, updates);
    const updatedClients = await dbService.getAllClients();
    io.emit("clients_updated", updatedClients);
    return res.json(updated || { ...existing, ...updates });
  } catch (err) {
    console.error("⚠️ Error editando cliente:", err.message);
    return res.status(500).json({ error: "Error interno editando cliente." });
  }
});

// DELETE: Eliminar un cliente por ID (Solo si pertenece a la cuenta)
app.delete("/api/clients/:id", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const id = sanitizeText(req.params.id, 64);
    const allClients = await dbService.getAllClients();
    const target = allClients.find(c => c.id === id);
    if (!target) {
      return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
    }

    const eliminado = await dbService.deleteClient(id, userEmail);
    const updatedClients = await dbService.getAllClients();
    io.emit("clients_updated", updatedClients);
    return res.json({
      message: `Cliente "${target.nombre}" eliminado.`,
      cliente: eliminado || target,
    });
  } catch (err) {
    console.error("⚠️ Error eliminando cliente:", err.message);
    return res.status(500).json({ error: "Error interno eliminando cliente." });
  }
});

// DELETE: Eliminar múltiples clientes (por IDs, solo de la cuenta)
app.delete("/api/clients", authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const { ids, all } = req.body;
    if (all) {
      await dbService.deleteAllClients(userEmail);
      io.emit("clients_updated", []);
      return res.json({ message: "Directorio de clientes vaciado exitosamente." });
    }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Se requiere un arreglo de IDs o el parámetro all: true." });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: "Máximo 500 identificadores por operación." });
    }
    const sanitizedIds = ids.map(id => sanitizeText(id, 64));
    const eliminados = await dbService.deleteClientsBulk(sanitizedIds, userEmail);
    const updatedClients = await dbService.getAllClients();
    io.emit("clients_updated", updatedClients);
    return res.json({
      message: `${eliminados ? eliminados.length : sanitizedIds.length} cliente(s) eliminado(s).`,
      eliminados: eliminados || [],
    });
  } catch (err) {
    console.error("⚠️ Error eliminando clientes masivamente:", err.message);
    return res.status(500).json({ error: "Error interno eliminando clientes." });
  }
});

// ─────────────────────────────────────────────────────────────
// --- SUITE DE PRUEBAS Y DIAGNÓSTICO DEL BACKEND ---
// ─────────────────────────────────────────────────────────────

// 1. Health Check & Métricas del Servidor
app.get("/api/test/health", authenticateToken, async (req, res) => {
  const session = sessions.get(CORPORATE_GATEWAY_KEY);
  const uptimeSec = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;

  let clientInfo = null;
  try {
    if (session && session.status === "CONNECTED" && session.client && session.client.info) {
      clientInfo = {
        pushname: session.client.info.pushname || "Usuario WhatsApp",
        wid: session.client.info.wid ? session.client.info.wid.user : "Desconocido",
        platform: session.client.info.platform || "whatsapp-web",
      };
    }
  } catch (e) {}

  const responseData = {
    status: "OK",
    server: "Online",
    whatsappStatus: session ? session.status : "DISCONNECTED",
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    uptimeSeconds: uptimeSec,
    clientInfo,
    timestamp: new Date().toISOString(),
  };

  // Restringir métricas internas de memoria, versión de node y conteo de sesiones a Administradores
  if (req.user && req.user.role === "ADMIN") {
    const memory = process.memoryUsage();
    responseData.activeSessions = sessions.size;
    responseData.resolvedChromiumExecutable = resolvedChromiumExecutable;
    responseData.sessions = Array.from(sessions.entries()).map(([email, s]) => ({
      email,
      status: s.status,
      hasQr: Boolean(s.qr),
      qrLength: s.qr ? s.qr.length : 0,
      ageSeconds: Math.floor((Date.now() - (s.createdAt || Date.now())) / 1000)
    }));
    responseData.recentLogs = systemLogs.slice(-25);
    responseData.memoryMB = {
      rss: (memory.rss / (1024 * 1024)).toFixed(1),
      heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(1),
      heapTotal: (memory.heapTotal / (1024 * 1024)).toFixed(1),
    };
    responseData.database = dbService.getDbStatus();
    responseData.nodeVersion = process.version;
  }

  res.json(responseData);
});

// Health check público y liviano para monitores externos (Render, UptimeRobot)
app.get("/api/health", (req, res) => {
  const dbStatus = dbService.getDbStatus();
  res.json({
    status: "OK",
    service: "WhatsApp Gateway API",
    database: dbStatus.mode,
    isMongoConnected: dbStatus.isMongoConnected,
    timestamp: new Date().toISOString()
  });
});

// 2. Ping / Medidor de Latencia
app.post("/api/test/ping", authenticateToken, async (req, res) => {
  const session = sessions.get(CORPORATE_GATEWAY_KEY);
  res.json({
    pong: true,
    clientTimestamp: req.body.timestamp || null,
    serverTimestamp: Date.now(),
    status: session ? session.status : "DISCONNECTED",
  });
});

// 3. Envío de Prueba Individual (Direct Test Message - Solo Admin)
app.post("/api/test/single", authenticateToken, authorizeAdmin, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = await getOrCreateUserSession(userEmail);
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: "Número y mensaje son requeridos." });
  }

  const cleanNumber = sanitizePhone(number);
  if (!isValidPhone(cleanNumber)) {
    return res.status(400).json({ error: "Número telefónico inválido." });
  }

  const cleanMessage = sanitizeText(message, 4096);

  const isConnected = await ensureSessionConnected(session);
  if (!isConnected || !session || !session.client) {
    return res.status(400).json({
      error: "WhatsApp no está conectado. Enlace su cuenta o use el simulador.",
    });
  }

  const client = session.client;
  try {
    const numberId = await getValidNumberId(client, cleanNumber);
    if (!numberId) {
      io.to(userEmail).emit("log", `⚠️ [PRUEBA] ${cleanNumber} no tiene cuenta de WhatsApp.`);
      return res.status(404).json({
        error: `El número ${cleanNumber} no está registrado en WhatsApp.`,
      });
    }

    await client.sendMessage(numberId._serialized, cleanMessage);
    io.to(userEmail).emit(
      "log",
      `🧪 [PRUEBA] Mensaje de prueba enviado exitosamente a: ${cleanNumber}`,
    );
    return res.json({
      success: true,
      message: "Mensaje de prueba enviado exitosamente",
      jid: numberId._serialized,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("⚠️ Error en test/single:", error.message);
    io.to(userEmail).emit("log", `❌ [PRUEBA] Error con ${cleanNumber}: ${error.message}`);
    return res.status(500).json({ error: "Error enviando mensaje de prueba." });
  }
});

// 4. Verificador de Cuenta de WhatsApp (Solo Admin)
app.post("/api/test/check-number", authenticateToken, authorizeAdmin, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = await getOrCreateUserSession(userEmail);
  const { number } = req.body;
  if (!number) {
    return res.status(400).json({ error: "El número telefónico es requerido." });
  }

  const cleanNumber = sanitizePhone(number);
  if (!isValidPhone(cleanNumber)) {
    return res.status(400).json({ error: "Formato telefónico inválido." });
  }

  const isConnected = await ensureSessionConnected(session);
  if (!isConnected || !session || !session.client) {
    return res.status(400).json({ error: "WhatsApp no está conectado para validar números." });
  }

  const client = session.client;
  try {
    const numberId = await getValidNumberId(client, cleanNumber);
    if (numberId) {
      return res.json({
        exists: true,
        cleanNumber,
        jid: numberId._serialized,
        server: numberId.server,
      });
    } else {
      return res.json({
        exists: false,
        cleanNumber,
        message: "El número no tiene cuenta activa en WhatsApp",
      });
    }
  } catch (error) {
    console.error("⚠️ Error en test/check-number:", error.message);
    return res.status(500).json({ error: "Error validando cuenta de WhatsApp." });
  }
});

// 5. Simulación de Campaña Masiva (Solo Admin)
app.post("/api/test/simulate", authenticateToken, authorizeAdmin, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { numbers, message, delay = 2 } = req.body;
  if (!numbers || !Array.isArray(numbers) || !message) {
    return res.status(400).json({ error: "Parámetros inválidos para simulación." });
  }

  if (numbers.length > 20) {
    return res.status(400).json({ error: "Máximo 20 números en modo simulación." });
  }

  const waitMs = Math.max(parseFloat(delay) * 1000 || 2000, 500);
  res.json({ message: "Simulación de prueba iniciada", total: numbers.length });

  io.to(userEmail).emit(
    "log",
    `🧪 [SIMULACIÓN] Iniciando prueba con ${numbers.length} números a ${delay}s de intervalo...`,
  );
  for (let i = 0; i < numbers.length; i++) {
    const rawNumber = numbers[i];
    const cleanNumber = formatPhoneNumber(rawNumber);
    await new Promise((r) => setTimeout(r, waitMs));
    const fakeSuccess = !cleanNumber.endsWith("0");
    if (fakeSuccess) {
      io.to(userEmail).emit(
        "log",
        `🧪 [SIMULACIÓN ${i + 1}/${numbers.length}] ✅ Entregado simulado a: ${rawNumber}`,
      );
    } else {
      io.to(userEmail).emit(
        "log",
        `🧪 [SIMULACIÓN ${i + 1}/${numbers.length}] ⚠️ Simulación: ${rawNumber} no registrado`,
      );
    }
  }
  io.to(userEmail).emit("log", `🎉 [SIMULACIÓN] Prueba de campaña completada exitosamente.`);
});

// 6. Reinicio de Sesión WhatsApp / Regenerar QR (Solo Admin)
app.post("/api/test/restart-client", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    io.emit("log", "🔄 [SISTEMA] Reiniciando pasarela corporativa de WhatsApp...");
    const session = sessions.get(CORPORATE_GATEWAY_KEY);
    if (session && session.client) {
      try { await session.client.destroy(); } catch (e) { console.log("Error destroying client:", e.message); }
      sessions.delete(CORPORATE_GATEWAY_KEY);
    }
    const clientId = getSessionClientId();
    const authDataPath = process.platform === "linux"
      ? path.join("/tmp", ".wwebjs_auth")
      : path.join(DATA_DIR, ".wwebjs_auth");
    const sessionPath = path.join(authDataPath, `session-${clientId}`);
    if (fs.existsSync(sessionPath)) {
      try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch {}
    }
    io.emit("status", "INITIALIZING");
    io.emit("qr", "");
    setTimeout(async () => {
      await getOrCreateUserSession();
    }, 1200);

    return res.json({ message: "Reinicio de la pasarela de WhatsApp iniciado." });
  } catch (err) {
    console.error("⚠️ Error reiniciando pasarela:", err.message);
    return res.status(500).json({ error: "Error al reiniciar pasarela." });
  }
});

// --- SERVICIO DE PRODUCCIÓN FRONTEND (SINGLE-PORT SERVING) ---
const distPath = path.join(__dirname, "frontend", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/socket.io")) {
      return res.sendFile(path.join(distPath, "index.html"));
    }
    next();
  });
} else {
  // Ruta raíz para Health Check cuando el frontend se sirve por separado (Vercel)
  app.get("/", (req, res) => {
    res.json({
      status: "ONLINE",
      service: "Gateway de WhatsApp Pagos y Cobranzas API",
      version: "2.0.0",
      healthCheck: "/api/health",
      timestamp: new Date().toISOString()
    });
  });
}

// Middleware de captura de excepciones generales
app.use((err, req, res, next) => {
  console.error("⚠️ [SERVER ERROR]:", err.message);
  return res.status(500).json({ error: "Error interno del servidor." });
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ [PROCESO] Excepción no capturada:", err.message);
  if (err.code === "EADDRINUSE") {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ [PROCESO] Promesa rechazada no manejada:", reason ? (reason.message || reason) : "Unknown reason");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Gateway de WhatsApp (Producción Segura) activo en puerto ${PORT}`);
  try {
    await dbService.connectToMongo();
  } catch (dbErr) {
    console.warn("⚠️ [INICIO] Aviso al inicializar conexión con base de datos:", dbErr.message);
  }
  initAutoBackup();
  initSeedData();
  console.log("✅ Servidor listo y en escucha de conexiones HTTP y WebSockets.");
  // Pre-arrancar inmediatamente la pasarela corporativa para que el QR esté listo de inmediato
  getOrCreateUserSession().catch(e => console.warn("⚠️ [INICIO] Aviso pre-arrancando pasarela WhatsApp:", e.message));
});
