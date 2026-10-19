const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { encryptField, decryptField } = require("./cryptoService");

// Directorio de persistencia local y réplicas
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

const DATA_DIR = getDataDir();
const SEEDS_DIR = path.join(__dirname, "..", "seeds");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
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

// Estado del cliente MongoDB
let mongoClient = null;
let mongoDb = null;
let isConnected = false;
let isConnecting = false;

// ── MÉTODOS LOCALES AUXILIARES DE RÉPLICA Y RESPALDO (AES-256-GCM) ──

function loadLocalClients() {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return [];
    const data = fs.readFileSync(CLIENTS_FILE, "utf-8");
    const list = JSON.parse(data) || [];
    return list.map(c => ({
      ...c,
      nota: decryptField(c.nota)
    }));
  } catch {
    return [];
  }
}

function saveLocalClients(clients) {
  try {
    const encryptedList = clients.map(c => ({
      ...c,
      nota: encryptField(c.nota)
    }));
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(encryptedList, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ [DB] Error escribiendo réplica local de clientes:", err.message);
  }
}

function loadLocalClientsForUser(userEmail) {
  // Directorio unificado de la empresa: accesible por todas las cuentas autorizadas
  return loadLocalClients();
}

function loadLocalUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")) || [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ [DB] Error escribiendo réplica local de usuarios:", err.message);
  }
}

function loadLocalTemplatesStore() {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadLocalTemplatesForUser(userEmail) {
  if (!userEmail) return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  const emailKey = userEmail.toLowerCase().trim();
  const store = loadLocalTemplatesStore();
  if (store[emailKey]) {
    return store[emailKey];
  }
  return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
}

function saveLocalTemplatesForUser(userEmail, data) {
  if (!userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();
  const store = loadLocalTemplatesStore();
  store[emailKey] = {
    plantillas: Array.isArray(data.plantillas) ? data.plantillas.slice(0, 20) : DEFAULT_TEMPLATES.plantillas,
    currentMessage: typeof data.currentMessage === "string" ? data.currentMessage.slice(0, 4096) : DEFAULT_TEMPLATES.currentMessage,
    delay: typeof data.delay === "number" ? Math.min(Math.max(data.delay, 1), 60) : DEFAULT_TEMPLATES.delay
  };
  try {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ [DB] Error escribiendo réplica local de plantillas:", err.message);
  }
}

// ── CONEXIÓN E INICIALIZACIÓN DE MONGODB ATLAS ──

async function connectToMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    console.log("ℹ️ [DB] MONGODB_URI no detectado en el entorno. Operando en Modo Local Seguro (AES-256-GCM).");
    return false;
  }

  if (isConnecting) return false;
  isConnecting = true;

  try {
    console.log("🔄 [DB] Conectando a MongoDB Atlas...");
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      maxPoolSize: 10,
    });

    await mongoClient.connect();
    // Usa la base de datos especificada en MONGODB_DB_NAME o en la URI; por defecto 'whatsapp_bot'
    const dbName = process.env.MONGODB_DB_NAME || undefined;
    mongoDb = mongoClient.db(dbName);
    isConnected = true;
    console.log(`✅ [DB] Conexión establecida exitosamente con MongoDB Atlas (Base de datos: ${mongoDb.databaseName}).`);

    // Crear índices de alto rendimiento y privacidad
    try {
      const clientsCollection = mongoDb.collection("clients");
      try {
        await clientsCollection.createIndex({ id: 1 }, { unique: true, name: "client_id_unique", sparse: true });
      } catch (idErr) {
        // Ignorar si ya existe un índice compatible
      }
      try {
        await clientsCollection.createIndex({ ownerEmail: 1 }, { name: "ownerEmail_idx" });
      } catch (oeErr) {}

      try {
        await mongoDb.collection("users").createIndex({ email: 1 }, { unique: true });
      } catch (uErr) {}

      try {
        await mongoDb.collection("templates").createIndex({ userEmail: 1 }, { unique: true });
      } catch (tErr) {}

      console.log("⚡ [DB] Índices de MongoDB configurados correctamente para el directorio corporativo.");
    } catch (idxErr) {
      console.warn("⚠️ [DB] Aviso al asegurar índices en MongoDB:", idxErr.message);
    }

    // Sincronización inteligente de semillas (Zero Data Loss)
    await syncSeedsToMongo();

    return true;
  } catch (err) {
    console.warn(`⚠️ [DB] No se pudo conectar a MongoDB Atlas (${err.message}). Continuando automáticamente en Modo Local Seguro.`);
    isConnected = false;
    mongoDb = null;
    return false;
  } finally {
    isConnecting = false;
  }
}

// Sincroniza datos locales / semillas con MongoDB para que no se pierda nada
async function syncSeedsToMongo() {
  if (!isConnected || !mongoDb) return;

  try {
    // 1. Clientes
    const clientsColl = mongoDb.collection("clients");
    const countClients = await clientsColl.countDocuments();
    const localClients = loadLocalClients();
    
    // Si la colección de MongoDB está vacía, migrar clientes locales o semillas
    if (countClients === 0) {
      let seedList = [];
      const seedClientsFile = path.join(SEEDS_DIR, "clients.json");
      if (fs.existsSync(seedClientsFile)) {
        try {
          seedList = JSON.parse(fs.readFileSync(seedClientsFile, "utf-8")) || [];
        } catch (e) {}
      }

      const listToInsert = localClients.length > 0 ? localClients : seedList;
      if (listToInsert.length > 0) {
        const docs = listToInsert.map(c => ({
          id: c.id,
          nombre: c.nombre,
          numero: c.numero,
          nota: encryptField(c.nota),
          ownerEmail: (c.ownerEmail || "").toLowerCase().trim(),
          agregadoEl: c.agregadoEl || new Date().toISOString()
        }));
        await clientsColl.insertMany(docs);
        console.log(`📦 [DB] Migrados ${docs.length} clientes a MongoDB Atlas.`);
      }
    } else {
      // Si ya hay clientes en MongoDB, asegurar que los clientes de semillas existan
      const seedClientsFile = path.join(SEEDS_DIR, "clients.json");
      if (fs.existsSync(seedClientsFile)) {
        try {
          const seedList = JSON.parse(fs.readFileSync(seedClientsFile, "utf-8")) || [];
          for (const s of seedList) {
            const exists = await clientsColl.findOne({ id: s.id });
            if (!exists) {
              await clientsColl.insertOne({
                id: s.id,
                nombre: s.nombre,
                numero: s.numero,
                nota: encryptField(s.nota),
                ownerEmail: (s.ownerEmail || "").toLowerCase().trim(),
                agregadoEl: s.agregadoEl || new Date().toISOString()
              });
              console.log(`🌱 [DB] Cliente semilla sincronizado en MongoDB: ${s.nombre} (${s.ownerEmail})`);
            }
          }
        } catch (e) {}
      }
    }

    // 2. Usuarios
    const usersColl = mongoDb.collection("users");
    const countUsers = await usersColl.countDocuments();
    const localUsers = loadLocalUsers();

    if (countUsers === 0 && localUsers.length > 0) {
      await usersColl.insertMany(localUsers);
      console.log(`👤 [DB] Migrados ${localUsers.length} usuarios a MongoDB Atlas.`);
    }

    // 3. Plantillas
    const tplColl = mongoDb.collection("templates");
    const countTpl = await tplColl.countDocuments();
    const localTpls = loadLocalTemplatesStore();
    const tplKeys = Object.keys(localTpls);

    if (countTpl === 0 && tplKeys.length > 0) {
      const docs = tplKeys.map(k => ({
        userEmail: k.toLowerCase().trim(),
        plantillas: localTpls[k].plantillas,
        currentMessage: localTpls[k].currentMessage,
        delay: localTpls[k].delay
      }));
      await tplColl.insertMany(docs);
      console.log(`📝 [DB] Migradas plantillas de ${docs.length} cuenta(s) a MongoDB Atlas.`);
    }
  } catch (syncErr) {
    console.warn("⚠️ [DB] Aviso durante la sincronización inicial de MongoDB:", syncErr.message);
  }
}

// ── OPERACIONES DE CLIENTES (DIRECTORIO COMPARTIDO DE LA EMPRESA) ──

async function getClientsForUser(userEmail) {
  // Directorio unificado de la empresa: todos los miembros autorizados acceden al directorio completo
  return await getAllClients();
}

async function getAllClients() {
  if (isConnected && mongoDb) {
    try {
      const docs = await mongoDb.collection("clients")
        .find({}, { projection: { _id: 0 } })
        .toArray();
      return docs.map(c => ({
        ...c,
        nota: decryptField(c.nota)
      }));
    } catch (err) {
      console.warn("⚠️ [DB] Error leyendo todos los clientes de MongoDB, usando respaldo local:", err.message);
    }
  }

  return loadLocalClients();
}

async function addClient(clientData) {
  const emailKey = (clientData.ownerEmail || "").toLowerCase().trim();
  const encryptedNota = encryptField(clientData.nota || "");

  const doc = {
    id: clientData.id || (Date.now().toString() + Math.random().toString(36).substring(2, 7)),
    nombre: clientData.nombre,
    numero: clientData.numero,
    nota: encryptedNota,
    ownerEmail: emailKey, // conservado para auditoría
    agregadoEl: clientData.agregadoEl || new Date().toISOString()
  };

  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("clients").insertOne({ ...doc });
    } catch (err) {
      console.warn("⚠️ [DB] Error insertando cliente en MongoDB:", err.message);
    }
  }

  // Actualizar espejo local
  const currentLocal = loadLocalClients();
  currentLocal.push({
    ...doc,
    nota: decryptField(doc.nota)
  });
  saveLocalClients(currentLocal);

  return {
    ...doc,
    nota: decryptField(doc.nota)
  };
}

async function updateClient(id, ownerEmail, updates) {
  const mongoUpdate = {};
  if (updates.nombre) mongoUpdate.nombre = updates.nombre;
  if (updates.numero) mongoUpdate.numero = updates.numero;
  if (updates.nota !== undefined) mongoUpdate.nota = encryptField(updates.nota);

  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("clients").updateOne(
        { id: id },
        { $set: mongoUpdate }
      );
    } catch (err) {
      console.warn("⚠️ [DB] Error actualizando cliente en MongoDB:", err.message);
    }
  }

  // Actualizar espejo local
  const currentLocal = loadLocalClients();
  const idx = currentLocal.findIndex(c => c.id === id);
  if (idx !== -1) {
    if (updates.nombre) currentLocal[idx].nombre = updates.nombre;
    if (updates.numero) currentLocal[idx].numero = updates.numero;
    if (updates.nota !== undefined) currentLocal[idx].nota = updates.nota;
    saveLocalClients(currentLocal);
    return currentLocal[idx];
  }
  return null;
}

async function deleteClient(id, ownerEmail) {
  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("clients").deleteOne({ id: id });
    } catch (err) {
      console.warn("⚠️ [DB] Error eliminando cliente de MongoDB:", err.message);
    }
  }

  // Actualizar espejo local
  const currentLocal = loadLocalClients();
  const idx = currentLocal.findIndex(c => c.id === id);
  let removed = null;
  if (idx !== -1) {
    removed = currentLocal.splice(idx, 1)[0];
    saveLocalClients(currentLocal);
  }
  return removed;
}

async function deleteClientsBulk(ids, ownerEmail) {
  const idSet = new Set(ids);

  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("clients").deleteMany({
        id: { $in: ids }
      });
    } catch (err) {
      console.warn("⚠️ [DB] Error en eliminación masiva de MongoDB:", err.message);
    }
  }

  // Actualizar espejo local
  const currentLocal = loadLocalClients();
  const removed = currentLocal.filter(c => idSet.has(c.id));
  const remaining = currentLocal.filter(c => !idSet.has(c.id));
  saveLocalClients(remaining);
  return removed;
}

async function importClientsBatch(newClientsList, userEmail) {
  const emailKey = (userEmail || "").toLowerCase().trim();
  if (!Array.isArray(newClientsList) || newClientsList.length === 0) return 0;

  // Cargar clientes existentes del usuario para evitar números duplicados
  const existing = await getClientsForUser(emailKey);
  const existingPhones = new Set(existing.map(c => (c.numero || "").replace(/\D/g, "")));

  const toInsert = [];
  for (const item of newClientsList) {
    const rawPhone = (item.numero || item.phone || "").toString().replace(/\D/g, "");
    const cleanName = (item.nombre || item.name || "Sin nombre").toString().trim().slice(0, 100);
    const cleanNota = (item.nota || "").toString().trim().slice(0, 500);

    if (rawPhone.length >= 7 && rawPhone.length <= 15 && !existingPhones.has(rawPhone)) {
      toInsert.push({
        id: crypto.randomUUID(),
        nombre: cleanName,
        numero: rawPhone,
        nota: cleanNota,
        ownerEmail: emailKey,
        agregadoEl: new Date().toISOString()
      });
      existingPhones.add(rawPhone);
    }
  }

  if (toInsert.length === 0) return 0;

  if (isConnected && mongoDb) {
    const docs = toInsert.map(c => ({
      ...c,
      nota: encryptField(c.nota)
    }));
    await mongoDb.collection("clients").insertMany(docs);
  }

  // Actualizar espejo local
  const allLocal = loadLocalClients();
  allLocal.push(...toInsert);
  saveLocalClients(allLocal);

  return toInsert.length;
}

async function syncLocalClientsToMongo(clients) {
  if (!isConnected || !mongoDb || !Array.isArray(clients) || clients.length === 0) return;
  try {
    const ops = clients.map(c => ({
      updateOne: {
        filter: {
          id: c.id,
          ownerEmail: (c.ownerEmail || "").toLowerCase().trim()
        },
        update: {
          $set: {
            id: c.id,
            nombre: c.nombre,
            numero: c.numero,
            nota: encryptField(c.nota),
            ownerEmail: (c.ownerEmail || "").toLowerCase().trim(),
            agregadoEl: c.agregadoEl || new Date().toISOString()
          }
        },
        upsert: true
      }
    }));
    await mongoDb.collection("clients").bulkWrite(ops);
  } catch (err) {
    console.warn("⚠️ [DB] Aviso al sincronizar lote de clientes con MongoDB:", err.message);
  }
}

// ── OPERACIONES DE USUARIOS (AUTENTICACIÓN Y ROLES) ──

async function getUsers() {
  if (isConnected && mongoDb) {
    try {
      const docs = await mongoDb.collection("users")
        .find({}, { projection: { _id: 0 } })
        .toArray();
      return docs;
    } catch (err) {
      console.warn("⚠️ [DB] Error leyendo usuarios de MongoDB, usando respaldo local:", err.message);
    }
  }
  return loadLocalUsers();
}

async function findUserByEmail(email) {
  if (!email) return null;
  const emailKey = email.toLowerCase().trim();

  if (isConnected && mongoDb) {
    try {
      const user = await mongoDb.collection("users").findOne(
        { email: emailKey },
        { projection: { _id: 0 } }
      );
      if (user) return user;
    } catch (err) {
      console.warn("⚠️ [DB] Error buscando usuario en MongoDB:", err.message);
    }
  }

  const local = loadLocalUsers();
  return local.find(u => (u.email || "").toLowerCase().trim() === emailKey) || null;
}

async function saveUser(user) {
  const emailKey = (user.email || "").toLowerCase().trim();
  const userDoc = { ...user, email: emailKey };

  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("users").updateOne(
        { email: emailKey },
        { $set: userDoc },
        { upsert: true }
      );
    } catch (err) {
      console.warn("⚠️ [DB] Error guardando usuario en MongoDB:", err.message);
    }
  }

  // Actualizar espejo local
  const local = loadLocalUsers();
  const idx = local.findIndex(u => (u.email || "").toLowerCase().trim() === emailKey);
  if (idx !== -1) {
    local[idx] = { ...local[idx], ...userDoc };
  } else {
    local.push(userDoc);
  }
  saveLocalUsers(local);
  return userDoc;
}

async function saveAllUsers(usersList) {
  if (isConnected && mongoDb) {
    try {
      const ops = usersList.map(u => ({
        updateOne: {
          filter: { email: (u.email || "").toLowerCase().trim() },
          update: { $set: { ...u, email: (u.email || "").toLowerCase().trim() } },
          upsert: true
        }
      }));
      if (ops.length > 0) {
        await mongoDb.collection("users").bulkWrite(ops);
      }
    } catch (err) {
      console.warn("⚠️ [DB] Error guardando lista de usuarios en MongoDB:", err.message);
    }
  }
  saveLocalUsers(usersList);
}

async function deleteUserAccountCompletely(targetEmail) {
  if (!targetEmail) return false;
  const emailKey = targetEmail.toLowerCase().trim();

  // 1. MongoDB
  if (isConnected && mongoDb) {
    try {
      await mongoDb.collection("users").deleteOne({ email: emailKey });
      await mongoDb.collection("clients").deleteMany({ ownerEmail: emailKey });
      await mongoDb.collection("templates").deleteOne({ userEmail: emailKey });
    } catch (err) {
      console.warn("⚠️ [DB] Error eliminando cuenta de usuario en MongoDB:", err.message);
    }
  }

  // 2. Espejos Locales
  const users = loadLocalUsers();
  const filteredUsers = users.filter(u => (u.email || "").toLowerCase().trim() !== emailKey);
  saveLocalUsers(filteredUsers);

  const allClients = loadLocalClients();
  const filteredClients = allClients.filter(c => (c.ownerEmail || "").toLowerCase().trim() !== emailKey);
  saveLocalClients(filteredClients);

  const tplStore = loadLocalTemplatesStore();
  if (tplStore[emailKey]) {
    delete tplStore[emailKey];
    try {
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(tplStore, null, 2), "utf-8");
    } catch (e) {}
  }

  return true;
}

// ── OPERACIONES DE PLANTILLAS DE COBRO ──

async function getTemplatesForUser(userEmail) {
  if (!userEmail) return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  const emailKey = userEmail.toLowerCase().trim();

  if (isConnected && mongoDb) {
    try {
      const doc = await mongoDb.collection("templates").findOne(
        { userEmail: emailKey },
        { projection: { _id: 0 } }
      );
      if (doc) {
        return {
          plantillas: doc.plantillas || DEFAULT_TEMPLATES.plantillas,
          currentMessage: doc.currentMessage || DEFAULT_TEMPLATES.currentMessage,
          delay: doc.delay || DEFAULT_TEMPLATES.delay
        };
      }
    } catch (err) {
      console.warn("⚠️ [DB] Error leyendo plantillas de MongoDB:", err.message);
    }
  }

  return loadLocalTemplatesForUser(emailKey);
}

async function saveTemplatesForUser(userEmail, data) {
  if (!userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();
  const tplData = {
    userEmail: emailKey,
    plantillas: Array.isArray(data.plantillas) ? data.plantillas.slice(0, 20) : DEFAULT_TEMPLATES.plantillas,
    currentMessage: typeof data.currentMessage === "string" ? data.currentMessage.slice(0, 4096) : DEFAULT_TEMPLATES.currentMessage,
    delay: typeof data.delay === "number" ? Math.min(Math.max(data.delay, 1), 60) : DEFAULT_TEMPLATES.delay,
    updatedAt: new Date().toISOString()
  };

  if (isConnected && mongoDb) {
    await mongoDb.collection("templates").updateOne(
      { userEmail: emailKey },
      { $set: tplData },
      { upsert: true }
    );
  }

  saveLocalTemplatesForUser(emailKey, tplData);
}

// ── ESTADO Y DIAGNÓSTICO ──

function getDbStatus() {
  return {
    isMongoConnected: isConnected,
    mode: isConnected ? "MongoDB Atlas" : "Almacenamiento Local Seguro (AES-256-GCM)",
    databaseName: isConnected && mongoDb ? mongoDb.databaseName : "local_file_system",
    mongoUriConfigured: !!(process.env.MONGODB_URI && process.env.MONGODB_URI.trim())
  };
}

module.exports = {
  connectToMongo,
  getDbStatus,
  isMongoConnected: () => isConnected,

  // Clientes
  getClientsForUser,
  getAllClients,
  addClient,
  updateClient,
  deleteClient,
  deleteClientsBulk,
  importClientsBatch,
  syncLocalClientsToMongo,

  // Usuarios
  getUsers,
  findUserByEmail,
  saveUser,
  saveAllUsers,
  deleteUserAccountCompletely,

  // Plantillas
  getTemplatesForUser,
  saveTemplatesForUser,

  // Métodos sincrónicos locales (para loops en tiempo real como WhatsApp)
  loadLocalClientsForUser,
  loadLocalClients,
  saveLocalClients,
  loadLocalUsers,
  saveLocalUsers,
  loadLocalTemplatesForUser,
  saveLocalTemplatesForUser
};
