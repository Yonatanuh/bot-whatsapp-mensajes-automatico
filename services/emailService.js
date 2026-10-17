const nodemailer = require("nodemailer");
const axios = require("axios");

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTransporter() {
  const user = (process.env.SMTP_EMAIL || "gonzalezyonild@gmail.com").trim();
  const pass = (process.env.SMTP_PASSWORD || "icgucczrdktyssae").trim();

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    secure: process.env.SMTP_SECURE === "false" ? false : true,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000
  });
}

async function sendViaVercelRelay(to, subject, html) {
  const relayUrl = (process.env.VERCEL_RELAY_URL || "https://bot-whatsapp-mensajes-automatico.vercel.app/api/send-email").trim();
  console.log(`📡 [EMAIL SERVICE] Intentando envío vía Relay HTTPS: ${relayUrl}`);
  const response = await axios.post(relayUrl, {
    to,
    subject,
    html
  }, {
    timeout: 10000,
    headers: { "Content-Type": "application/json" }
  });
  if (response.data && response.data.success) {
    console.log(`✅ [EMAIL SERVICE] Correo entregado exitosamente vía Relay HTTPS a: ${to}`);
    return response.data;
  }
  throw new Error(response.data?.error || "Error en respuesta de Vercel Relay");
}

async function sendViaDirectSMTP(to, subject, htmlMsg) {
  const transporter = getTransporter();
  const senderEmail = (process.env.SMTP_EMAIL || "gonzalezyonild@gmail.com").trim();
  const mailOptions = {
    from: `"Bot WhatsApp Admin" <${senderEmail}>`,
    to,
    subject,
    html: htmlMsg
  };
  console.log(`📡 [EMAIL SERVICE] Intentando envío directo vía SMTP Gmail a: ${to}`);
  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ [EMAIL SERVICE] Correo entregado exitosamente vía SMTP directo a: ${to}`);
  return info;
}

async function enviarEmailRegistro(nombre, email, token) {
  const cleanName = escapeHtml((nombre || "Usuario").toString().trim().slice(0, 100));
  const cleanEmail = (email || "").toString().trim().slice(0, 254);
  const asunto = `WhatsApp Bot - Tu Código de Verificación: ${token}`;

  const htmlMsg = `<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 30px; border-radius: 12px; background: #0f172a; color: #f8fafc; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #25d366; margin: 0; font-size: 26px;">WhatsApp Bot</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">Activación de Cuenta Segura</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5;">Hola <strong>${cleanName}</strong>,</p>
        <p style="font-size: 15px; color: #cbd5e1; line-height: 1.5;">Para completar tu registro y activar tu cuenta, ingresa el siguiente código de verificación de 6 dígitos en la aplicación:</p>
        
        <div style="text-align: center; margin: 25px 0; padding: 18px; background: #1e293b; border-radius: 10px; border: 2px solid #00a884;">
            <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #25d366; font-family: 'Courier New', monospace; display: inline-block;">${escapeHtml(token)}</span>
        </div>

        <p style="font-size: 13px; color: #94a3b8; text-align: center;">⏱️ Este código expirará en <strong>15 minutos</strong>.</p>
        <p style="font-size: 13px; color: #64748b; text-align: center; border-top: 1px solid #1e293b; padding-top: 15px;">
            Si no solicitaste este registro en WhatsApp Bot, puedes ignorar este correo de forma segura.<br>
            <span style="font-size: 12px; color: #475569;">Nota: Si no encuentras el correo en tu bandeja principal, revisa la carpeta de <strong>Spam</strong> o Correo no deseado.</span>
        </p>
    </div>`;

  let lastError = null;

  // En la nube (Render Free), los puertos SMTP 25, 465 y 587 están bloqueados a nivel de firewall.
  // Por tanto, en producción intentamos primero vía Vercel Relay (HTTPS puerto 443).
  // Si estamos en local (o si el relay falla), intentamos SMTP directo.
  const isCloud = process.env.NODE_ENV === "production" || process.env.RENDER === "true";

  if (isCloud) {
    try {
      return await sendViaVercelRelay(cleanEmail, asunto, htmlMsg);
    } catch (errRelay) {
      console.warn("⚠️ Falló relay HTTPS Vercel, intentando SMTP directo:", errRelay.message);
      lastError = errRelay;
    }
  }

  try {
    return await sendViaDirectSMTP(cleanEmail, asunto, htmlMsg);
  } catch (errSmtp) {
    console.warn("⚠️ Falló SMTP directo:", errSmtp.message);
    lastError = errSmtp;
  }

  if (!isCloud) {
    try {
      return await sendViaVercelRelay(cleanEmail, asunto, htmlMsg);
    } catch (errRelay2) {
      lastError = errRelay2;
    }
  }

  throw lastError || new Error("No se pudo entregar el correo de verificación.");
}

module.exports = {
  enviarEmailRegistro
};
