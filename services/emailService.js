const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_EMAIL || "tu_correo@gmail.com",
        pass: process.env.SMTP_PASSWORD || "tu_contraseña_de_aplicacion"
    }
});

async function enviarEmailRegistro(nombre, email, token) {
    const asunto = "WhatsApp Bot - Tu Código de Activación: " + token;
    const htmlMsg = `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border-radius: 12px; background: #0f172a; color: #f8fafc;">
        <h2 style="color: #00a884; text-align: center; margin-bottom: 20px;">¡Bienvenido!</h2>
        <p style="font-size: 16px;">Hola <strong>${nombre || "Usuario"}</strong>,</p>
        <p style="font-size: 15px; color: #94a3b8;">Tu cuenta está casi lista. Tu código de verificación de 6 dígitos es:</p>
        <div style="text-align: center; margin: 25px 0; padding: 15px; background: #1e293b; border-radius: 8px; border: 1px solid #00a884;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #25d366; font-family: monospace;">${token}</span>
        </div>
        <p style="font-size: 14px; color: #94a3b8;">Ingresa este código en la aplicación para activar tu cuenta.</p>
    </div>`;

    const mailOptions = {
        from: '"Bot WhatsApp Admin" <' + process.env.SMTP_EMAIL + '>',
        to: email,
        subject: asunto,
        html: htmlMsg
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log("====== CORREO ENVIADO CON EXITO A: " + email + " ======");
        return info;
    } catch (error) {
        console.error("Error al enviar el correo vía Nodemailer:", error.message);
        throw new Error("Error en EmailService: " + error.message);
    }
}

module.exports = {
    enviarEmailRegistro
};
