async function resolveRegisteredNumberId(client, cleanNumber) {
  const candidates = [cleanNumber];

  if (cleanNumber.startsWith("1") && cleanNumber.length === 11) {
    candidates.push(cleanNumber.substring(1));
  }
  if (cleanNumber.startsWith("52") && cleanNumber.length === 12) {
    candidates.push(cleanNumber.replace(/^52/, "521"));
  }

  for (const candidate of new Set(candidates)) {
    const numberId = await client.getNumberId(candidate);
    if (numberId && numberId._serialized) return numberId;
  }

  return null;
}

async function sendWhatsAppMessage(client, jid, message) {
  const targetJid = jid && jid.includes("@") ? jid : `${jid}@c.us`;
  let sentMessage;

  try {
    sentMessage = await client.sendMessage(targetJid, message, {
      waitUntilMsgSent: true
    });
  } catch (err) {
    // Si falla waitUntilMsgSent por timeout o respuesta tardía de ACK, reintentar envío estándar
    sentMessage = await client.sendMessage(targetJid, message);
  }

  if (!sentMessage) {
    sentMessage = await client.sendMessage(targetJid, message);
  }

  if (!sentMessage) {
    throw new Error("WhatsApp no confirmó el envío del mensaje.");
  }

  return sentMessage;
}

module.exports = { resolveRegisteredNumberId, sendWhatsAppMessage };
