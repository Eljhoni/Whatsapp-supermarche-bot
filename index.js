const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let sock = null;
let qrCodeData = null;
let connectionStatus = 'Démarrage...';

// Route pour voir le QR code
app.get('/', async (req, res) => {
  console.log('>>> Route / appelée, qrCodeData =', qrCodeData ? 'EXSITE' : 'NULL');
  
  if (qrCodeData) {
    try {
      const qrImage = await QRCode.toDataURL(qrCodeData);
      res.send(`
        <html>
          <head>
            <title>WhatsApp Bot - QR Code</title>
            <meta http-equiv="refresh" content="5">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px; background: #1a1a1a; color: white; }
              .container { background: #2d2d2d; padding: 30px; border-radius: 10px; display: inline-block; }
              img { max-width: 300px; border-radius: 8px; }
              .status { margin-top: 20px; padding: 15px; border-radius: 5px; font-weight: bold; }
              .waiting { background: #ffc107; color: #000; }
              .connected { background: #28a745; color: white; }
              .disconnected { background: #dc3545; color: white; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🤖 WhatsApp Bot</h1>
              <h2>Scanne ce QR code avec WhatsApp</h2>
              <img src="${qrImage}" alt="QR Code WhatsApp">
              <div class="status waiting">
                ⏳ Statut: ${connectionStatus}
              </div>
              <p style="margin-top:20px; color:#aaa; font-size:14px;">
                La page se rafraîchit toutes les 5 secondes.<br>
                <strong>Attention :</strong> Le QR expire en ~20 secondes. Sois rapide !
              </p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('>>> Erreur génération QR:', err);
      res.status(500).send('Erreur: ' + err.message);
    }
  } else {
    res.send(`
      <html>
        <head>
          <title>WhatsApp Bot</title>
          <meta http-equiv="refresh" content="3">
          <style>
            body { font-family: sans-serif; text-align: center; padding: 40px; background: #1a1a1a; color: white; }
            .container { background: #2d2d2d; padding: 30px; border-radius: 10px; display: inline-block; }
            .status { padding: 15px; border-radius: 5px; background: #ffc107; color: #000; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            <div class="status">
              ⏳ ${connectionStatus}
            </div>
            <p style="margin-top:20px; color:#aaa;">
              En attente du QR code...<<br>
              Rafraîchissement auto dans 3s
            </p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', connection: connectionStatus, hasQR: !!qrCodeData });
});

async function connectToWhatsApp() {
  console.log('>>> Démarrage connectToWhatsApp()...');
  
  try {
    // Nettoyage si ancienne session corrompue
    const authDir = './auth_info_baileys';
    if (fs.existsSync(authDir) && fs.existsSync(path.join(authDir, 'creds.json'))) {
      console.log('>>> Session existante trouvée, tentative reconnexion...');
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    console.log('>>> Auth state initialisé');

    sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '22.04.4'],
      version: [2, 3000, 1015901307], // Version fixe pour stabilité
      logger: undefined, // Pas de logger verbeux
    });
    
    console.log('>>> Socket créé avec succès');

    sock.ev.on('creds.update', saveCreds);
    console.log('>>> Handler creds.attaché');

    sock.ev.on('connection.update', async (update) => {
      console.log('>>> EVENT connection.update:', JSON.stringify(update));
      
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('>>> ✅ QR CODE REÇU !');
        qrCodeData = qr;
        connectionStatus = 'QR prêt - SCANNE MAINTENANT !';
      }

      if (connection === 'close') {
        qrCodeData = null;
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
          : true;
        
        console.log('>>> Connection fermée. Reconnect?', shouldReconnect);
        connectionStatus = 'Déconnecté - Reconnexion...';

        if (shouldReconnect) {
          setTimeout(connectToWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        connectionStatus = '✅ CONNECTÉ !';
        console.log('>>> ✅ CONNECTÉ AVEC SUCCÈS !');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      console.log('>>> Message reçu:', m.type);
    });

  } catch (err) {
    console.error('>>> ERREUR FATALE:', err);
    connectionStatus = 'Erreur: ' + err.message;
    setTimeout(connectToWhatsApp, 10000);
  }
}

// Démarrage
app.listen(PORT, '0.0.0.0', () => {
  console.log(`>>> 🚀 Serveur Express démarré sur 0.0.0.0:${PORT}`);
  console.log(`>>> URL: https://ton-app.onrender.com/`);
  
  // Délai pour laisser Express s'initialiser
  setTimeout(() => {
    console.log('>>> Lancement du bot WhatsApp...');
    connectToWhatsApp();
  }, 2000);
});


