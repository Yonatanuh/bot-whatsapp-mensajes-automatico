const nodemailer = require("nodemailer");

function getTransporter() {
  const user = (process.env.SMTP_EMAIL || "gonzalezyonild@gmail.com").trim();
  const pass = (process.env.SMTP_PASSWORD || "icgucczrdktyssae").trim();

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 10000
  });
}

async function enviarEmailRegistro(nombre, email, token) {
  const senderEmail = (process.env.SMTP_EMAIL || "gonzalezyonild@gmail.com").trim();
  const asunto = "¡Bienvenido a WhatsApp Bot! Tu cuenta ha sido activada";
  const htmlMsg = `<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 30px; border-radius: 12px; background: #0f172a; color: #f8fafc; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #25d366; margin: 0; font-size: 26px;">WhatsApp Bot</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">Gateway de Pagos y Notificaciones</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5;">Hola <strong>${nombre || "Usuario"}</strong>,</p>
        <p style="font-size: 15px; color: #cbd5e1; line-height: 1.5;">¡Tu cuenta ha sido creada y activada con éxito! Ya puedes acceder a tu panel de control, vincular tu WhatsApp mediante código QR y automatizar tus cobranzas.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="https://bot-whatsapp-mensajes-automatico.vercel.app" style="background: #00a884; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">Acceder a mi Panel</a>
        </div>
        <p style="font-size: 13px; color: #64748b; text-align: center; border-top: 1px solid #1e293b; padding-top: 15px;">
            Tu correo de acceso es: <strong style="color: #94a3b8;">${email}</strong>
        </p>
    </div>`;

  const mailOptions = {
    from: `"Bot WhatsApp Admin" <${senderEmail}>`,
    to: email,
    subject: asunto,
    html: htmlMsg
  };

  const transporter = getTransporter();
  const info = await transporter.sendMail(mailOptions);
  console.log("====== CORREO DE BIENVENIDA ENVIADO CON ÉXITO A: " + email + " ======");
  return info;
}

module.exports = {
  enviarEmailRegistro
};
