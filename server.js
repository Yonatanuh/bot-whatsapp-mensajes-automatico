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
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

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
  if (!userEmail) return [];
  const emailKey = userEmail.toLowerCase().trim();
  const all = loadClients();
  return all.filter((c) => (c.ownerEmail || "").toLowerCase().trim() === emailKey);
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

function saveTemplatesForUser(userEmail, data) {
  if (!userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();
  const store = loadAllTemplatesStore();
  store[emailKey] = {
    plantillas: Array.isArray(data.plantillas) ? data.plantillas.slice(0, 20) : DEFAULT_TEMPLATES.plantillas,
    currentMessage: typeof data.currentMessage === "string" ? data.currentMessage.slice(0, 4096) : DEFAULT_TEMPLATES.currentMessage,
    delay: typeof data.delay === "number" ? Math.min(Math.max(data.delay, 1), 60) : DEFAULT_TEMPLATES.delay
  };
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// Configuración de Seguridad Estricta por Variables de Entorno
const SECRET_KEY = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!SECRET_KEY || !ADMIN_USER || !ADMIN_PASS) {
  console.error(
    "CRITICAL: Faltan variables de entorno esenciales (JWT_SECRET, ADMIN_USER, ADMIN_PASS). Configure el archivo .env",
  );
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// 1. Confianza en Proxy para Render / Load Balancers (Fundamental para IP Rate-Limiting correcto)
app.set("trust proxy", 1);

// 2. Proteger cabeceras HTTP y fingerprint
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
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
});
app.use("/api/", apiLimiter);

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

// Rate limiter específico para campañas de envío (prevención de spam y abuso de Puppeteer)
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: {
    error: "Límite de campañas por minuto alcanzado. Por favor espere antes de enviar nuevamente.",
  },
  standardHeaders: true,
  legacyHeaders: false,
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
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.includes(origin) ||
      origin.includes("localhost") ||
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".onrender.com");
    if (isAllowed) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
};
app.use(cors(corsOptions));

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
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

  const hashedPassword = bcrypt.hashSync(password, 10);
  users.push({
    name: cleanName,
    email: cleanEmail,
    password: hashedPassword,
    role: "USER",
    verifiedAt: new Date().toISOString()
  });
  saveUsers(users);

  const token = jwt.sign({ role: "USER", email: cleanEmail }, SECRET_KEY, { expiresIn: "24h" });
  setAuthCookie(res, token);

  enviarEmailRegistro(cleanName, cleanEmail, "ACTIVADA")
    .then(() => console.log(`📧 [EMAIL BIENVENIDA] Enviado exitosamente a: ${cleanEmail}`))
    .catch((err) => console.warn(`⚠️ [EMAIL BIENVENIDA] No se pudo entregar: ${err.message}`));

  return res.json({
    token,
    message: "¡Cuenta creada exitosamente! Bienvenido al sistema.",
    user: { name: cleanName, email: cleanEmail }
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
  if (!pending) return res.status(400).json({ error: "No hay registro pendiente o expiró." });
  if (pending.expires < Date.now()) {
    delete pendingRegistrations[cleanEmail];
    return res.status(400).json({ error: "El código de verificación ha expirado." });
  }
  if (!safeCompare(pending.token, cleanCode)) {
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
  setAuthCookie(res, token);
  res.json({ token, message: "Registro exitoso." });
});

app.post("/api/login", (req, res) => {
  const { username, email, password } = req.body;
  const rawId = username || email;
  if (!rawId || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Credenciales requeridas." });
  }

  const identifier = rawId.toString().trim().toLowerCase().slice(0, 254);
  const envAdminEmail = (process.env.ADMIN_EMAIL || "admin@gateway.com").toLowerCase().trim();
  const envAdminUser = (process.env.ADMIN_USER || "admin").toLowerCase().trim();
  const envAdminPass = process.env.ADMIN_PASS;

  // 1. Acceso de Super Administrador con protección de tiempo constante
  const isAdminIdentifier = (identifier === envAdminEmail || identifier === envAdminUser);
  if (isAdminIdentifier && safeCompare(password, envAdminPass)) {
    const token = jwt.sign({ role: "ADMIN", email: envAdminEmail }, SECRET_KEY, { expiresIn: "24h" });
    setAuthCookie(res, token);
    return res.json({ token, message: "Login exitoso como Administrador." });
  }

  // 2. Acceso de Usuarios Registrados con BCRYPT
  const users = loadUsers();
  const userIndex = users.findIndex(u => (u.email || "").toLowerCase() === identifier);

  if (userIndex !== -1) {
    const user = users[userIndex];
    const isMatch = (user.password && (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")))
      ? bcrypt.compareSync(password, user.password)
      : safeCompare(password, user.password);

    if (isMatch) {
      // Auto-upgrade de seguridad si existía en texto plano
      if (user.password && !user.password.startsWith("$2")) {
        users[userIndex].password = bcrypt.hashSync(password, 10);
        saveUsers(users);
      }

      // El rol ADMIN solo se asigna si en la base de datos es ADMIN o es el ADMIN_EMAIL de entorno
      const assignedRole = (user.role === "ADMIN" || user.email.toLowerCase() === envAdminEmail)
        ? "ADMIN"
        : "USER";

      const token = jwt.sign({ role: assignedRole, email: user.email }, SECRET_KEY, { expiresIn: "24h" });
      setAuthCookie(res, token);
      return res.json({ token, message: "Login exitoso." });
    }
  }

  return res.status(401).json({ error: "Credenciales inválidas." });
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
  if (session) {
    socket.emit("status", session.status);
    if (session.status === "QR_READY" && session.qr) {
      socket.emit("qr", session.qr);
    }
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

// Endpoint Protegido para enviar mensajes (Sesión y Logs aislados por cuenta)
app.post("/api/send", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);

  if (!session || session.status !== "CONNECTED" || !session.client) {
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

  let parsedDelay = delay ? parseFloat(delay) * 1000 : 4000;
  if (isNaN(parsedDelay)) {
    parsedDelay = 4000;
  }
  parsedDelay = Math.min(Math.max(parsedDelay, 1000), 60000); // Rango 1s a 60s

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
          `🔄 [SISTEMA] Sesión de WhatsApp caída. Reiniciando servidor en segundo plano...`,
        );
        setTimeout(() => process.exit(1), 500);
      }
    }
  }
  io.to(userEmail).emit("log", `🚀 Campaña finalizada.`);
});

// Envío Automático a contactos de cobro del usuario con reemplazo de variables
app.post("/api/send-auto-collections", authenticateToken, async (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const session = getOrCreateUserSession(userEmail);

  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res.status(400).json({ error: "Tu cuenta de WhatsApp no está vinculada. Por favor escanea tu código QR en la Consola." });
  }

  const client = session.client;
  const { messageTemplate, delay } = req.body;
  if (!messageTemplate || typeof messageTemplate !== "string" || !messageTemplate.trim()) {
    return res.status(400).json({ error: "La plantilla del mensaje es requerida." });
  }

  const clients = loadClientsForUser(userEmail);
  if (!clients || clients.length === 0) {
    return res.status(400).json({ error: "No tienes clientes en tu directorio de cobro personal." });
  }

  if (clients.length > MAX_NUMBERS_PER_BATCH) {
    return res.status(400).json({
      error: `Directorio excede el límite de envío seguro (${clients.length} contactos). Máximo permitido: ${MAX_NUMBERS_PER_BATCH}.`
    });
  }

  let parsedDelay = delay ? parseFloat(delay) * 1000 : 4000;
  parsedDelay = Math.min(Math.max(parsedDelay, 1000), 60000);

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
    status: session ? session.status : "DISCONNECTED",
    qr: session && session.status === "QR_READY" ? session.qr : ""
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
  const safeUsers = users.map(u => ({
    name: u.name,
    email: u.email,
    role: u.role || "USER",
    verifiedAt: u.verifiedAt
  }));
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
    console.error("⚠️ Error generando backup:", err.message);
    res.status(500).json({ error: "Error al generar la copia de seguridad." });
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
  saveTemplatesForUser(userEmail, req.body || {});
  res.json({ success: true });
});

// POST: Agregar un cliente nuevo a la cuenta autenticada
app.post("/api/clients", authenticateToken, (req, res) => {
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

  const allClients = loadClients();
  const userClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase() === userEmail);
  const existe = userClients.find((c) => c.numero === cleanNumero);
  if (existe) {
    return res.status(409).json({ error: `El número ${cleanNumero} ya existe en tu directorio.` });
  }

  const nuevoCliente = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
    nombre: cleanNombre,
    numero: cleanNumero,
    nota: cleanNota,
    ownerEmail: userEmail,
    agregadoEl: new Date().toISOString(),
  };

  allClients.push(nuevoCliente);
  saveClients(allClients);

  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.status(201).json(nuevoCliente);
});

// PUT: Editar un cliente existente de la cuenta autenticada
app.put("/api/clients/:id", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const id = sanitizeText(req.params.id, 64);
  const { nombre, numero, nota } = req.body;

  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === id && (c.ownerEmail || "").toLowerCase() === userEmail);
  if (idx === -1) {
    return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
  }

  if (numero) {
    const cleanNumero = sanitizePhone(numero);
    if (!isValidPhone(cleanNumero)) {
      return res.status(400).json({ error: "Número inválido. Debe contener entre 7 y 15 dígitos numéricos." });
    }
    const duplicado = allClients.find(
      (c) => (c.ownerEmail || "").toLowerCase() === userEmail && c.numero === cleanNumero && c.id !== id,
    );
    if (duplicado) {
      return res.status(409).json({
        error: `El número ${cleanNumero} ya está registrado en otro cliente de tu directorio.`,
      });
    }
    allClients[idx].numero = cleanNumero;
  }

  if (nombre) {
    const cleanNombre = sanitizeText(nombre, 100);
    if (cleanNombre.length < 2) {
      return res.status(400).json({ error: "El nombre debe tener al menos 2 caracteres." });
    }
    allClients[idx].nombre = cleanNombre;
  }

  if (nota !== undefined) {
    allClients[idx].nota = sanitizeText(nota, 500);
  }

  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase() === userEmail);
  io.to(userEmail).emit("clients_updated", updatedUserClients);
  return res.json(allClients[idx]);
});

// DELETE: Eliminar un cliente por ID (Solo si pertenece a la cuenta)
app.delete("/api/clients/:id", authenticateToken, (req, res) => {
  const userEmail = req.user.email.toLowerCase();
  const id = sanitizeText(req.params.id, 64);
  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === id && (c.ownerEmail || "").toLowerCase() === userEmail);
  if (idx === -1) {
    return res.status(404).json({ error: "Cliente no encontrado en tu directorio." });
  }
  const eliminado = allClients.splice(idx, 1)[0];
  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase() === userEmail);
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
  if (ids.length > 500) {
    return res.status(400).json({ error: "Máximo 500 identificadores por operación." });
  }
  const sanitizedIds = ids.map(id => sanitizeText(id, 64));
  let allClients = loadClients();
  const eliminados = allClients.filter((c) => sanitizedIds.includes(c.id) && (c.ownerEmail || "").toLowerCase() === userEmail);
  allClients = allClients.filter((c) => !(sanitizedIds.includes(c.id) && (c.ownerEmail || "").toLowerCase() === userEmail));
  saveClients(allClients);
  const updatedUserClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase() === userEmail);
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
    responseData.memoryMB = {
      rss: (memory.rss / (1024 * 1024)).toFixed(1),
      heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(1),
      heapTotal: (memory.heapTotal / (1024 * 1024)).toFixed(1),
    };
    responseData.nodeVersion = process.version;
  }

  res.json(responseData);
});

// Health check público y liviano para monitores externos (Render, UptimeRobot)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "WhatsApp Gateway API",
    timestamp: new Date().toISOString()
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

  const cleanNumber = sanitizePhone(number);
  if (!isValidPhone(cleanNumber)) {
    return res.status(400).json({ error: "Número telefónico inválido." });
  }

  const cleanMessage = sanitizeText(message, 4096);

  if (!session || session.status !== "CONNECTED" || !session.client) {
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
  const session = getOrCreateUserSession(userEmail);
  const { number } = req.body;
  if (!number) {
    return res.status(400).json({ error: "El número telefónico es requerido." });
  }

  const cleanNumber = sanitizePhone(number);
  if (!isValidPhone(cleanNumber)) {
    return res.status(400).json({ error: "Formato telefónico inválido." });
  }

  if (!session || session.status !== "CONNECTED" || !session.client) {
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
    console.error("⚠️ Error reiniciando cliente:", err.message);
    return res.status(500).json({ error: "Error al reiniciar cliente." });
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
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Gateway de WhatsApp (Producción Segura) activo en puerto ${PORT}`);
  initAutoBackup();
  const defaultAdminEmail = (process.env.ADMIN_EMAIL || "admin@gateway.com").toLowerCase().trim();
  getOrCreateUserSession(defaultAdminEmail);
});
