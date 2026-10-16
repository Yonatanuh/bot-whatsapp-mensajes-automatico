# 🚀 Gateway de Pagos y Cobranzas Automatizadas WhatsApp

Plataforma empresarial de alta disponibilidad para la automatización de cobranzas, notificaciones masivas y gestión multicuenta vía WhatsApp Web con arquitectura aislada, seguridad criptográfica y protección anti-hacker.

---

## 🔒 Arquitectura de Seguridad (Web & Anti-Hacker)

- **Aislamiento Multi-Sesión por Usuario**: Cada usuario o agente registrado gestiona su propia sesión independiente de WhatsApp (`LocalAuth({ clientId })`) sin acceso cruzado a las conversaciones de otros.
- **Cifrado de Datos en Reposo (AES-256-GCM)**: Notas y saldos confidenciales se encriptan con clave autenticada de 256 bits y vector de inicialización único (IV) antes de guardarse en disco.
- **Protección Anti-DDoS y Fuerza Bruta**:
  - `express-rate-limit` con limitador global estricto.
  - Limitador reforzado en `/api/login`, `/api/register` y `/api/verify` (máximo 15 intentos por ventana de 15 minutos).
- **Hardening de Cabeceras HTTP**: `helmet` habilitado para mitigar Clickjacking, MIME sniffing y ocultar la huella del servidor (`x-powered-by: false`).
- **Autenticación Robusta 2FA / JWT**: Verificación por código de 6 dígitos enviado por correo electrónico SMTP y tokens JWT firmados con algoritmo HS256.
- **Respaldos Automatizados**: Sistema programado de backups diarios automáticos con retención de copias y rotación preventiva.

---

## 📁 Estructura del Proyecto

```text
├── server.js              # Servidor backend Express + Socket.IO + WhatsApp Multi-Session
├── render.yaml            # Manifiesto de despliegue automatizado para Render (Backend)
├── services/
│   ├── cryptoService.js   # Cifrado AES-256-GCM en reposo
│   ├── backupService.js   # Respaldos automáticos y rotación
│   └── emailService.js    # Envíos de correo SMTP / 2FA
├── frontend/              # Aplicación Web React + Tailwind CSS + Lucide
│   ├── src/
│   ├── vercel.json        # Configuración de rutas SPA para Vercel
│   └── vite.config.js     # Bundler Vite configurado para producción
├── .env.example           # Plantilla de variables de entorno (segura para Git)
└── .gitignore             # Reglas estrictas de exclusión (sin fugas de credenciales)
```

---

## ⚙️ Configuración y Variables de Entorno

Copia el archivo `.env.example` como `.env` y configura los valores requeridos:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `PORT` | Puerto de escucha del backend (default `3000`) |
| `NODE_ENV` | `production` o `development` |
| `JWT_SECRET` | Clave secreta criptográfica para firmar JWT |
| `ADMIN_USER` | Usuario administrador |
| `ADMIN_PASS` | Contraseña maestra del administrador |
| `ADMIN_EMAIL` | Correo del administrador para alertas |
| `SMTP_EMAIL` | Correo de salida para enviar códigos de verificación 2FA |
| `SMTP_PASSWORD` | Contraseña de aplicación del correo SMTP |
| `CORS_ORIGIN` | Dominios autorizados (ej: `https://tu-frontend.vercel.app`) |
| `DATA_DIR` | *(Opcional)* Ruta de almacenamiento persistente en la nube |

---

## 🚀 Despliegue en Producción

### 1. Backend en Render
1. Conecta este repositorio en **Render.com** seleccionando **New Web Service**.
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. Agrega un disco persistente montado en `/var/data` para preservar las sesiones de WhatsApp y bases de datos entre despliegues.
5. Define las variables de entorno en el panel de Render.

### 2. Frontend en Vercel
1. Importa este repositorio en **Vercel.com**.
2. Selecciona como carpeta raíz (`Root Directory`): `frontend`.
3. Configura la variable de entorno:
   - `VITE_API_URL`: URL pública de tu backend en Render (ej: `https://gateway-whatsapp-pagos-api.onrender.com`).
4. Haz clic en **Deploy**.

---

## 📜 Licencia
Uso exclusivo y privado. Todos los derechos reservados.
