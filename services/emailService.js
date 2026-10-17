const nodemailer = require("nodemailer");

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
    connectionTimeout: 10000
  });
}

async function enviarEmailRegistro(nombre, email, token) {
  const transporter = getTransporter();

  const cleanName = escapeHtml((nombre || "Usuario").toString().trim().slice(0, 100));
  const cleanEmail = escapeHtml((email || "").toString().trim().slice(0, 254));
  const senderEmail = (process.env.SMTP_EMAIL || "gonzalezyonild@gmail.com").trim();
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

  const mailOptions = {
    from: `"Bot WhatsApp Admin" <${senderEmail}>`,
    to: email,
    subject: asunto,
    html: htmlMsg
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`====== CÓDIGO DE VERIFICACIÓN ENVIADO CON ÉXITO A: ${email} ======`);
  return info;
}

module.exports = {
  enviarEmailRegistro
};
