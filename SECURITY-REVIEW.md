# Revisión de seguridad - bot-whatsapp-pagos

## Hallazgo principal

### 1) Control de acceso insuficiente sobre la pasarela corporativa de WhatsApp
- Severidad: HIGH
- Archivo: `server.js`
- Rango relevante: `server.js:862-1100`, `server.js:1382-1469`
- Riesgo: La sesión corporativa compartida se exponía a todos los clientes Socket.IO autenticados, no solo a administradores. Esto permitía obtener el QR de vinculación, o reiniciarlo, sin un control de autorización adecuado.
- Corrección aplicada: se restringió el acceso a la pasarela y a los eventos del QR a usuarios con rol `ADMIN`, y se protegieron los endpoints de estado/desconexión con un middleware específico (`authorizeCorporateGateway`).

## Recomendaciones adicionales
- Mantener `JWT_SECRET` y `ADMIN_PASS` en variables de entorno sin valores por defecto conocidos.
- Evitar almacenar secretos en código fuente o logs.
- Usar salas Socket.IO restringidas por rol en lugar de difusiones globales para cualquier evento sensible.
- Revisar periódicamente permisos por rol y definir un flujo explícito de administración de la pasarela.
