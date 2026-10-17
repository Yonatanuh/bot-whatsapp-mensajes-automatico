import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Manejo de CORS para llamadas desde Render o frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  try {
    const { to, subject, html, secret } = req.body || {};
    
    // Verificación básica del payload
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos (to, subject, html).' });
    }

    const user = (process.env.SMTP_EMAIL || 'gonzalezyonild@gmail.com').trim();
    const pass = (process.env.SMTP_PASSWORD || 'icgucczrdktyssae').trim();

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 10000
    });

    const mailOptions = {
      from: `"Bot WhatsApp Admin" <${user}>`,
      to,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[VERCEL EMAIL RELAY] Correo enviado exitosamente a: ${to}`);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      envelope: info.envelope
    });
  } catch (error) {
    console.error('[VERCEL EMAIL RELAY ERROR]:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
