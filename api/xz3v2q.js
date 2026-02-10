import { CONFIG_SHEETS } from '../credenciales/google-sheets.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const forwarded = req.headers['x-forwarded-for'];
    const socketIp = req.socket?.remoteAddress;
    let rawIp = forwarded?.split(',')[0]?.trim() || socketIp;

    if (rawIp === '::1' || rawIp?.startsWith('::ffff:127.')) rawIp = undefined;

    const isValidPublicIp =
      rawIp &&
      !rawIp.startsWith('10.') &&
      !rawIp.startsWith('192.168') &&
      !rawIp.startsWith('172.') &&
      !rawIp.startsWith('141.') &&
      !rawIp.startsWith('127.') &&
      !rawIp.startsWith('::ffff:192.') &&
      !rawIp.startsWith('::ffff:10.');

    const clientIp = isValidPublicIp ? rawIp : '';
    const userAgent = req.headers['user-agent'] || '';

    const {
      event_source_url,
      fbp,
      fbc,
      email,
      phone,
      fn,
      ln,
      zip,
      ct,
      st,
      country,
      event_id,
      external_id,
      utm_campaign,
      event_time,
      telefono_asignado,
      device_type,
      geo_city,     
      geo_region,     
      geo_country,
      promo_code
    } = req.body || {};

    if (!event_id && !phone && !email) {
      return res.status(400).json({ error: 'Faltan datos mínimos (event_id / phone / email).' });
    }

    const sheetPayload = {
      timestamp: new Date().toISOString(),
      phone: phone || '',
      email: email || '',
      fn: fn || '',
      ln: ln || '',
      ct: ct || '',
      st: st || '',
      zip: zip || '',
      country: country || '',
      fbp: fbp || '',
      fbc: fbc || '',
      event_id: event_id || '',
      clientIP: clientIp,
      agentuser: userAgent,
      estado: '',
      valor: '',
      estado_envio: '',
      observaciones: '',
      external_id: external_id || '',
      utm_campaign: utm_campaign || '',
      event_source_url: event_source_url || '',
      event_time: event_time || Math.floor(Date.now() / 1000),
      telefono_asignado: telefono_asignado || '',
      device_type: device_type || '',
      geo_city: geo_city || '',          
      geo_region: geo_region || '',       
      geo_country: geo_country || '',
      promo_code: promo_code || ''
    };

    const gsRes = await fetch(CONFIG_SHEETS.GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetPayload)
    });

    const responseText = await gsRes.text();
    if (!gsRes.ok) {
      console.error('❌ Error desde Google Sheets:', responseText);
      return res.status(502).json({ error: 'Sheets error', details: responseText });
    }

    console.log('✅ Registrado en Google Sheets:', responseText);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error interno:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
