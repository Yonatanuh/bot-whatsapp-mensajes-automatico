# Instrucciones de Copilot para bot-whatsapp-pagos

## Arquitectura
- Backend principal: `server.js` con Express, Socket.IO, JWT, WhatsApp Web (`whatsapp-web.js`) y almacenamiento local/JSON con `DATA_DIR`.
- Servicios auxiliares: `services/*.js` para cifrado, backups, email y QR.
- Frontend React + Vite en `frontend/` con `src/components/Dashboard.jsx` y `src/components/Login.jsx`.
- Persistencia operativa: `clients.json`, `users.json`, `templates.json`, además de sesiones WhatsApp bajo `.wwebjs_auth`.

## Comandos reales
- Instalar dependencias: `npm install`
- Ejecutar backend: `npm run dev` o `npm start`
- Ejecutar frontend: `cd frontend && npm install && npm run dev`
- Compilar frontend: `cd frontend && npm run build`
- Ejecutar pruebas: `npm test`

## Convenciones
- Mantén la seguridad con JWT, cookies HttpOnly y validación de roles.
- No publiques secretos ni credenciales por defecto; usa `.env` local con valores reales.
- Para cambios de QR/WhatsApp, valida que el payload sea `data:image/png;base64,...` y no se vacíe al cambiar de estado.
- Prioriza correcciones pequeñas, verificables y sin romper el flujo existente.
