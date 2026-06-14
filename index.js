const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = null;
let connectionStatus = 'Démarrage...';

app.get('/', async (req, res) => {
  if (qrCodeData) {
    try {
      const qrImage = await QRCode.toDataURL(qrCodeData);
      res.send(`
        <html>
          <head>
            <title>WhatsApp Bot</title>
            <meta http-equiv="refresh" content="5">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px; background: #1a1a1a; color: white; }
              .container { background: #2d2d2d; padding: 30px; border-radius: 10px; display: inline-block; }
              img { max-width: 300px; }
              .status { margin-top: 20px; padding: 15px; border-radius: 5px; background: #ffc107; color: #000; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🤖 WhatsApp Bot</h1>
              <h2>Scanne ce QR code</h2>
              <img src="${qrImage}" alt="QR Code">
              <div class="status">${connectionStatus}</div>
              <p style="color:#aaa; font-size:14px;">QR expire en ~20s, sois rapide !</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send('Erreur: ' + err.message);
    }
  } else {
    res.send(`
      <html>
        <head><title>WhatsApp Bot</title><meta http-equiv="refresh" content="3"></head>
        <body style="text-align:center; padding:40px; font-family:sans-serif; background:#1a1a1a; color:white;">
          <div style="background:#2d2d2d; padding:30px; border-radius:10px; display:inline-block;">
            <h1>🤖 WhatsApp Bot</h1>
            <div style="padding:15px; background:#ffc107; color:#000; border-radius:5px; font-weight:bold;">
              ${connectionStatus}
            </div>
            <p style="color:#aaa;">En attente du QR...</p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: connectionStatus, hasQR: !!qrCodeData });
});

async function startBot() {
  console.log('>>> Démarrage bot...');
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    console.log('>>> Auth state OK');

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`>>> Version Baileys: ${version.join('.')}, latest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '22.04.4']
    });
    
    console.log('>>> Socket créé');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      console.log('>>> Event:', JSON.stringify(update));
      
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('>>> QR REÇU !');
        qrCodeData = qr;
        connectionStatus = 'QR PRÊT - SCANNE !';
      }

      if (connection === 'close') {
        qrCodeData = null;
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
          : true;
        
        console.log('>>> Déconnecté, reconnect?', shouldReconnect);
        connectionStatus = 'Reconnexion...';

        if (shouldReconnect) {
          setTimeout(startBot, 5000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        connectionStatus = 'CONNECTÉ !';
        console.log('>>> CONNECTÉ !');
      }
    });

  } catch (err) {
    console.error('>>> ERREUR:', err.message);
    connectionStatus = 'Erreur: ' + err.message;
    setTimeout(startBot, 10000);
  }
}

app.listen(PORT, () => {
  console.log(`>>> Serveur sur port ${PORT}`);
  startBot();
});

