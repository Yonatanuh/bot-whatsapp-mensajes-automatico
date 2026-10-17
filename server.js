require("dotenv").config();
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
const { encryptField, decryptField } = require("./services/cryptoService");
const { createBackup, listBackups, initAutoBackup } = require("./services/backupService");

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
}

function loadClientsForUser(userEmail) {
  const emailKey = (userEmail || "gonzalezyonild@gmail.com").toLowerCase();
  const all = loadClients();
  return all.filter((c) => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === emailKey);
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
  const emailKey = (userEmail || "gonzalezyonild@gmail.com").toLowerCase();
  const store = loadAllTemplatesStore();
  if (store[emailKey]) {
    return store[emailKey];
  }
  // Migración retrocompatible si el archivo estaba en formato plano
  if (store.plantillas) {
    return store;
  }
  return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
}

function saveTemplatesForUser(userEmail, data) {
  const emailKey = (userEmail || "gonzalezyonild@gmail.com").toLowerCase();
  const store = loadAllTemplatesStore();
  if (store.plantillas && !store[emailKey]) {
    delete store.plantillas;
    delete store.currentMessage;
    delete store.delay;
  }
  store[emailKey] = {
    plantillas: data.plantillas || DEFAULT_TEMPLATES.plantillas,
    currentMessage: data.currentMessage !== undefined ? data.currentMessage : DEFAULT_TEMPLATES.currentMessage,
    delay: data.delay !== undefined ? data.delay : DEFAULT_TEMPLATES.delay
  };
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), "utf-8");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Configuración de Seguridad (Estricta por Variables de Entorno)
const SECRET_KEY = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!SECRET_KEY || !ADMIN_USER || !ADMIN_PASS) {
  console.error(
    "CRITICAL: Faltan variables de entorno (JWT_SECRET, ADMIN_USER, ADMIN_PASS). Configure el archivo .env",
  );
  process.exit(1);
}

// --- CONFIGURACIÓN DE SEGURIDAD AVANZADA (ANTI-HACKER) ---
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

// 1. Proteger cabeceras HTTP (ocultar fingerprint del servidor)
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));

// 2. Rate Limiting general para el API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: {
    error: "Has superado el límite de peticiones. Intenta de nuevo más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// 3. Rate Limiting estricto contra ataques de fuerza bruta en autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    error: "Demasiados intentos de acceso desde esta IP. Por seguridad, intente en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);
app.use("/api/verify", authLimiter);

// Configuración CORS dinámica
const allowedOrigins = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*"
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
  : "*";
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "2mb" }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "JSON inválido en la solicitud." });
  }
  next(err);
});

// --- SISTEMA DE AUTENTICACIÓN PROTEGIDO ---

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Faltan datos obligatorios." });

  const cleanEmail = email.toString().trim().toLowerCase();
  const cleanName = (name || "").toString().trim().slice(0, 100);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: "Formato de correo electrónico inválido." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  }

  const users = loadUsers();
  if (users.find(u => (u.email || "").toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: "El correo ya está registrado." });
  }

  // Registro directo e instantáneo con máxima seguridad (Bcrypt)
  const hashedPassword = bcrypt.hashSync(password, 10);
  users.push({
    name: cleanName,
    email: cleanEmail,
    password: hashedPassword,
    role: "USER",
    verifiedAt: new Date().toISOString()
  });
  saveUsers(users);

  // Generamos el token de sesión JWT de inmediato (24h de validez)
  const token = jwt.sign({ role: "USER", email: cleanEmail }, SECRET_KEY, { expiresIn: "24h" });

  // Envío de correo de bienvenida en segundo plano (asíncrono sin bloquear la respuesta al usuario)
  enviarEmailRegistro(cleanName, cleanEmail, "ACTIVADA")
    .then(() => console.log(`📧 [EMAIL BIENVENIDA] Enviado exitosamente a: ${cleanEmail}`))
    .catch((err) => console.warn(`⚠️ [EMAIL BIENVENIDA] No se pudo entregar a ${cleanEmail}: ${err.message}`));

  return res.json({
    token,
    message: "¡Cuenta creada exitosamente! Bienvenido al sistema.",
    user: { name: cleanName, email: cleanEmail }
  });
});

app.post("/api/verify", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Datos incompletos." });

  const cleanEmail = email.toString().trim().toLowerCase();
  const pending = pendingRegistrations[cleanEmail];

  if (!pending) return res.status(400).json({ error: "No hay registro pendiente o expiró." });
  if (pending.expires < Date.now()) {
    delete pendingRegistrations[cleanEmail];
    return res.status(400).json({ error: "El código de verificación ha expirado." });
  }
  if (pending.token !== code.toString().trim()) {
    return res.status(400).json({ error: "Código incorrecto." });
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
  res.json({ token, message: "Registro exitoso." });
});

app.post("/api/login", (req, res) => {
  const { username, email, password } = req.body;
  const rawId = username || email;
  if (!rawId || !password) return res.status(400).json({ error: "Credenciales requeridas." });

  const identifier = rawId.toString().trim().toLowerCase();
  const envAdminEmail = (process.env.ADMIN_EMAIL || "admin@gateway.com").toLowerCase();
  const envAdminPass = process.env.ADMIN_PASS || "AdminSecurePass2026!";

  // 1. Acceso de Super Administrador por entorno
  if ((identifier === envAdminEmail || identifier === "admin") && password === envAdminPass) {
    const token = jwt.sign({ role: "ADMIN", email: envAdminEmail }, SECRET_KEY, { expiresIn: "24h" });
    return res.json({ token, message: "Login exitoso como Administrador." });
  }

  // 2. Acceso de Usuarios Registrados con BCRYPT
  const users = loadUsers();
  const userIndex = users.findIndex(u => (u.email || "").toLowerCase() === identifier);

  if (userIndex !== -1) {
    const user = users[userIndex];
    const isMatch = (user.password && (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")))
      ? bcrypt.compareSync(password, user.password)
      : user.password === password;

    if (isMatch) {
      // Auto-upgrade de seguridad si estaba en texto plano
      if (user.password && !user.password.startsWith("$2")) {
        users[userIndex].password = bcrypt.hashSync(password, 10);
        saveUsers(users);
      }

      const assignedRole = (user.role === "ADMIN" || user.email === "gonzalezyonild@gmail.com" || user.email === envAdminEmail)
        ? "ADMIN"
        : "USER";

      const token = jwt.sign({ role: assignedRole, email: user.email }, SECRET_KEY, { expiresIn: "24h" });
      return res.json({ token, message: "Login exitoso." });
    }
  }

  return res.status(401).json({ error: "Credenciales inválidas." });
});

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

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

// Middleware para proteger endpoints exclusivos de Administrador (Anti-IDOR / Anti-Privilege Escalation)
const authorizeAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  next();
};

// Middleware para proteger WebSockets
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return next(new Error("Authentication error"));
    socket.user = decoded;
    next();
  });
});

// --- SISTEMA MULTI-SESIÓN WHATSAPP (AISLADO POR CUENTA) ---
const sessions = new Map();

function getSessionClientId(userEmail) {
  return (userEmail || "admin").toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function getOrCreateUserSession(userEmail) {
  const cleanEmail = (userEmail || "").toLowerCase().trim();
  if (!cleanEmail) return null;

  if (sessions.has(cleanEmail)) {
    return sessions.get(cleanEmail);
  }

  const clientId = getSessionClientId(cleanEmail);
  const sessionData = {
    client: null,
    status: "INITIALIZING",
    qr: "",
    userEmail: cleanEmail,
    info: null
  };
  sessions.set(cleanEmail, sessionData);

  const authDataPath = path.join(DATA_DIR, ".wwebjs_auth");
  const puppeteerConfig = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: authDataPath }),
    puppeteer: puppeteerConfig,
  });

  sessionData.client = client;

  client.on("qr", async (qr) => {
    sessionData.status = "QR_READY";
    sessionData.qr = await qrcode.toDataURL(qr);
    io.to(cleanEmail).emit("status", "QR_READY");
    io.to(cleanEmail).emit("qr", sessionData.qr);
    console.log(`📱 [QR] Código QR generado para: ${cleanEmail}`);
  });

  client.on("ready", () => {
    sessionData.status = "CONNECTED";
    sessionData.qr = "";
    try {
      sessionData.info = client.info;
    } catch {}
    io.to(cleanEmail).emit("status", "CONNECTED");
    io.to(cleanEmail).emit("qr", "");
    console.log(`✅ [WHATSAPP] Sesión vinculada con éxito para: ${cleanEmail}`);
  });

  client.on("disconnected", (reason) => {
    sessionData.status = "DISCONNECTED";
    sessionData.qr = "";
    sessionData.info = null;
    io.to(cleanEmail).emit("status", "DISCONNECTED");
    io.to(cleanEmail).emit("qr", "");
    console.log(`⚠️ [WHATSAPP] Sesión desconectada para ${cleanEmail}: ${reason}`);
  });

  client.initialize().catch((err) => {
    console.error(`⚠️ Error al inicializar WhatsApp para ${cleanEmail}:`, err.message);
    sessionData.status = "DISCONNECTED";
    io.to(cleanEmail).emit("status", "DISCONNECTED");
  });

  return sessionData;
}

io.on("connection", (socket) => {
  const userEmail = socket.user && socket.user.email ? socket.user.email.toLowerCase() : null;
  if (!userEmail) return;

  socket.join(userEmail);

  const session = getOrCreateUserSession(userEmail);
  socket.emit("status", session.status);
  if (session.status === "QR_READY" && session.qr) {
    socket.emit("qr", session.qr);
  }
});

// Funciones auxiliares para formato de números
function formatPhoneNumber(rawNumber) {
  let cleanNumber = rawNumber.toString().replace(/\D/g, ""); // Solo dígitos
  // Si es un número de República Dominicana sin el 1 (10 dígitos empezando con 809/829/849)
  if (cleanNumber.length === 10 && /^(809|829|849)/.test(cleanNumber)) {
    cleanNumber = "1" + cleanNumber;
  }
  return cleanNumber;
}

async function getValidNumberId(client, cleanNumber) {
  // Intento 1: Normal
  let numberId = await client.getNumberId(cleanNumber);
  if (numberId) return numberId;

  // Intento 2: Si empieza con 1 y tiene 11 dígitos (ej: US/DR), intentar sin el 1
  if (cleanNumber.startsWith("1") && cleanNumber.length === 11) {
    numberId = await client.getNumberId(cleanNumber.substring(1));
    if (numberId) return numberId;
  }

  // Intento 3: Si es de México (52) o Argentina (54), a veces requiere el '1' o '9'
  if (cleanNumber.startsWith("52") && cleanNumber.length === 12) {
    numberId = await client.getNumberId(cleanNumber.replace(/^52/, "521"));
    if (numberId) return numberId;
  }

  // Intento 4: Verificación directa asumiendo que es válido si todo lo anterior falla
  try {
    const isRegistered = await client.isRegisteredUser(cleanNumber + "@c.us");
    if (isRegistered) {
      return {
        _serialized: cleanNumber + "@c.us",
        server: "c.us",
        user: cleanNumber,
      };
    }
  } catch (e) {
    // Ignorar si falla la verificación directa
  }

  return null;
}

// Endpoint Protegido para enviar mensajes (Sesión y Logs aislados por cuenta)
app.post("/api/send", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);

  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res.status(400).json({ error: "Tu cuenta de WhatsApp no está vinculada. Por favor escanea tu código QR en la Consola." });
  }

  const client = session.client;
  const { numbers, message, delay } = req.body;
  if (!numbers || !Array.isArray(numbers) || !message) {
    return res.status(400).json({ error: "Datos inválidos." });
  }

  let parsedDelay = delay ? parseFloat(delay) * 1000 : 4000;
  if (isNaN(parsedDelay)) {
    parsedDelay = 4000;
  }
  parsedDelay = Math.max(parsedDelay, 1000);

  res.json({ message: "Envío iniciado", total: numbers.length });

  for (const rawNumber of numbers) {
    try {
      const cleanNumber = formatPhoneNumber(rawNumber);
      const numberId = await getValidNumberId(client, cleanNumber);

      if (numberId) {
        await client.sendMessage(numberId._serialized, message);
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
          `🔄 [SISTEMA] Sesión de WhatsApp caída. Reiniciando servidor en segundo plano...`,
        );
        setTimeout(() => process.exit(1), 500);
      }
    }
  }
  io.to(userEmail).emit("log", `🚀 Campaña finalizada.`);
});

// 🤖 Envío Automático a contactos de cobro del usuario con reemplazo de variables
app.post("/api/send-auto-collections", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);

  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res.status(400).json({ error: "Tu cuenta de WhatsApp no está vinculada. Por favor escanea tu código QR en la Consola." });
  }

  const client = session.client;
  const { messageTemplate, delay } = req.body;
  if (!messageTemplate) {
    return res
      .status(400)
      .json({ error: "El mensaje (plantilla) es requerido." });
  }

  const clients = loadClientsForUser(userEmail);
  if (!clients || clients.length === 0) {
    return res
      .status(400)
      .json({ error: "No tienes clientes en tu directorio de cobro personal." });
  }

  let parsedDelay = delay ? parseFloat(delay) * 1000 : 4000;
  parsedDelay = Math.max(parsedDelay, 1000);

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
      const numberId = await getValidNumberId(client, cleanNumber);

      if (numberId) {
        // Reemplazar variables en el mensaje
        let mensajePersonalizado = messageTemplate
          .replace(/{{nombre}}/g, cliente.nombre || "Cliente")
          .replace(/{{nota}}/g, cliente.nota || "")
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
          `🔄 [SISTEMA] Sesión de WhatsApp caída. Reiniciando servidor en segundo plano...`,
        );
        setTimeout(() => process.exit(1), 500);
      }
    }
  }
  io.to(userEmail).emit("log", `🚀 [COBRO AUTOMÁTICO] Campaña finalizada con éxito.`);
});

// Obtener estado actual personal del usuario
app.get("/api/status", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);
  res.json({
    status: session.status,
    qr: session.status === "QR_READY" ? session.qr : ""
  });
});

// Desvincular WhatsApp / Generar nuevo código QR personal
app.post("/api/whatsapp/disconnect", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = sessions.get(userEmail);
  if (session && session.client) {
    try { await session.client.logout(); } catch {}
    try { await session.client.destroy(); } catch {}
    sessions.delete(userEmail);
  }
  const clientId = getSessionClientId(userEmail);
  const sessionPath = path.join(DATA_DIR, ".wwebjs_auth", `session-${clientId}`);
  if (fs.existsSync(sessionPath)) {
    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch {}
  }
  io.to(userEmail).emit("status", "INITIALIZING");
  io.to(userEmail).emit("qr", "");
  setTimeout(() => {
    getOrCreateUserSession(userEmail);
  }, 600);
  res.json({ success: true, message: "WhatsApp desvinculado con éxito. Generando nuevo código QR..." });
});

// ─────────────────────────────────────────────────────────────
// --- GESTIÓN DE CLIENTES / DIRECTORIO (CRUD AISLADO POR CUENTA) ---
// ─────────────────────────────────────────────────────────────

// GET: Listar los clientes propios de la cuenta autenticada
app.get("/api/clients", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const clients = loadClientsForUser(userEmail);
  res.json(clients);
});

// GET: Listar todos los usuarios (Solo Administrador)
app.get("/api/users", authenticateToken, authorizeAdmin, (req, res) => {
  const users = loadUsers();
  const safeUsers = users.map(u => ({ name: u.name, email: u.email, verifiedAt: u.verifiedAt }));
  res.json(safeUsers);
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
    res.status(500).json({ error: "Error al generar copia de seguridad: " + err.message });
  }
});

// GET: Obtener plantillas personales de la cuenta
app.get("/api/templates", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  res.json(loadTemplatesForUser(userEmail));
});

// PUT: Guardar plantillas personales de la cuenta
app.put("/api/templates", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  saveTemplatesForUser(userEmail, req.body);
  res.json({ success: true });
});

// POST: Agregar un cliente nuevo a la cuenta autenticada
app.post("/api/clients", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { nombre, numero, nota } = req.body;
  if (!nombre || !numero) {
    return res
      .status(400)
      .json({ error: "El nombre y el número son obligatorios." });
  }
  const cleanNumero = numero.toString().replace(/\s+/g, "").replace("+", "");
  if (!/^\d{7,15}$/.test(cleanNumero)) {
    return res.status(400).json({
      error:
        "Número inválido. Use formato internacional sin + (ej: 18095550123).",
    });
  }

  const allClients = loadClients();
  const userClients = allClients.filter(c => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  const existe = userClients.find((c) => c.numero === cleanNumero);
  if (existe) {
    return res
      .status(409)
      .json({ error: `El número ${cleanNumero} ya existe en tu directorio.` });
  }

  const nuevoCliente = {
    id: Date.now().toString(),
    nombre: nombre.trim(),
    numero: cleanNumero,
    nota: nota ? nota.trim() : "",
    ownerEmail: userEmail,
    agregadoEl: new Date().toISOString(),
  };

  allClients.push(nuevoCliente);
  saveClients(allClients);

  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.status(201).json(nuevoCliente);
});

// PUT: Editar un cliente existente de la cuenta autenticada
app.put("/api/clients/:id", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { id } = req.params;
  const { nombre, numero, nota } = req.body;

  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === id && (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  if (idx === -1) {
    return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
  }

  if (numero) {
    const cleanNumero = numero.toString().replace(/\s+/g, "").replace("+", "");
    if (!/^\d{7,15}$/.test(cleanNumero)) {
      return res.status(400).json({ error: "Número inválido." });
    }
    const duplicado = allClients.find(
      (c) => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail && c.numero === cleanNumero && c.id !== id,
    );
    if (duplicado) {
      return res.status(409).json({
        error: `El número ${cleanNumero} ya está registrado en otro cliente de tu directorio.`,
      });
    }
    allClients[idx].numero = cleanNumero;
  }

  if (nombre) allClients[idx].nombre = nombre.trim();
  if (nota !== undefined) allClients[idx].nota = nota.trim();

  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.json(allClients[idx]);
});

// DELETE: Eliminar un cliente por ID (Solo si pertenece a la cuenta)
app.delete("/api/clients/:id", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { id } = req.params;
  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === id && (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  if (idx === -1) {
    return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
  }
  const eliminado = allClients.splice(idx, 1)[0];
  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.json({
    message: `Cliente "${eliminado.nombre}" eliminado.`,
    cliente: eliminado,
  });
});

// DELETE: Eliminar múltiples clientes (por IDs, solo de la cuenta)
app.delete("/api/clients", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Se requiere un arreglo de IDs." });
  }
  let allClients = loadClients();
  const eliminados = allClients.filter((c) => ids.includes(c.id) && (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  allClients = allClients.filter((c) => !(ids.includes(c.id) && (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail));
  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "gonzalezyonild@gmail.com").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.json({
    message: `${eliminados.length} cliente(s) eliminado(s).`,
    eliminados,
  });
});

// ─────────────────────────────────────────────────────────────
// --- SUITE DE PRUEBAS Y DIAGNÓSTICO DEL BACKEND ---
// ─────────────────────────────────────────────────────────────

// 1. Health Check & Métricas del Servidor
app.get("/api/test/health", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);
  const memory = process.memoryUsage();
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
  } catch (e) {
    // Ignorar si aún no está disponible
  }

  res.json({
    status: "OK",
    server: "Online",
    whatsappStatus: session ? session.status : "DISCONNECTED",
    activeSessions: sessions.size,
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    uptimeSeconds: uptimeSec,
    memoryMB: {
      rss: (memory.rss / (1024 * 1024)).toFixed(1),
      heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(1),
      heapTotal: (memory.heapTotal / (1024 * 1024)).toFixed(1),
    },
    nodeVersion: process.version,
    clientInfo,
    timestamp: new Date().toISOString(),
  });
});

// 2. Ping / Medidor de Latencia
app.post("/api/test/ping", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);
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
  const session = getOrCreateUserSession(userEmail);
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: "Número y mensaje son requeridos." });
  }

  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res.status(400).json({
      error: "WhatsApp no está conectado. Enlace su cuenta o use el simulador.",
    });
  }

  const client = session.client;
  const cleanNumber = formatPhoneNumber(number);
  try {
    const numberId = await getValidNumberId(client, cleanNumber);
    if (!numberId) {
      io.to(userEmail).emit("log", `⚠️ [PRUEBA] ${cleanNumber} no tiene cuenta de WhatsApp.`);
      return res.status(404).json({
        error: `El número ${cleanNumber} no está registrado en WhatsApp.`,
      });
    }

    await client.sendMessage(numberId._serialized, message);
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
    io.to(userEmail).emit("log", `❌ [PRUEBA] Error con ${cleanNumber}: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// 4. Verificador de Cuenta de WhatsApp (Solo Admin)
app.post("/api/test/check-number", authenticateToken, authorizeAdmin, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);
  const { number } = req.body;
  if (!number) {
    return res
      .status(400)
      .json({ error: "El número telefónico es requerido." });
  }

  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res
      .status(400)
      .json({ error: "WhatsApp no está conectado para validar números." });
  }

  const client = session.client;
  const cleanNumber = formatPhoneNumber(number);
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
    return res.status(500).json({ error: error.message });
  }
});

// 5. Simulación de Campaña Masiva (Solo Admin)
app.post("/api/test/simulate", authenticateToken, authorizeAdmin, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const { numbers, message, delay = 2 } = req.body;
  if (!numbers || !Array.isArray(numbers) || !message) {
    return res
      .status(400)
      .json({ error: "Parámetros inválidos para simulación." });
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
  const userEmail = req.user.email.toLowerCase();
  try {
    io.to(userEmail).emit("log", "🔄 [SISTEMA] Reiniciando cliente de WhatsApp...");
    const session = sessions.get(userEmail);
    if (session && session.client) {
      try { await session.client.destroy(); } catch (e) { console.log("Error destroying client:", e.message); }
      sessions.delete(userEmail);
    }
    io.to(userEmail).emit("status", "INITIALIZING");
    io.to(userEmail).emit("qr", "");
    setTimeout(() => {
      getOrCreateUserSession(userEmail);
    }, 1200);

    return res.json({ message: "Reinicio del cliente de WhatsApp iniciado." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
  // Ruta raíz para Health Check de Render / Vercel cuando el frontend se sirve por separado
  app.get("/", (req, res) => {
    res.json({
      status: "ONLINE",
      service: "Gateway de WhatsApp Pagos y Cobranzas API",
      version: "1.0.0",
      healthCheck: "/api/test/health",
      timestamp: new Date().toISOString()
    });
  });
}

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
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Gateway de WhatsApp (Producción Segura) activo en puerto ${PORT}`);
  // Iniciar temporizador de respaldos automáticos diarios
  initAutoBackup();
  // Pre-inicializar sesión del Administrador para que esté conectada de inmediato
  const defaultAdminEmail = (process.env.ADMIN_EMAIL || "gonzalezyonild@gmail.com").toLowerCase();
  getOrCreateUserSession(defaultAdminEmail);
});




