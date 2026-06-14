const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useSingleFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Fichier de session pour Baileys
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

let sock = null;
let qrCodeData = null;
let connectionStatus = 'Déconnecté';

// Route pour voir le QR code en image
app.get('/', async (req, res) => {
  if (qrCodeData) {
    try {
      const qrImage = await QRCode.toDataURL(qrCodeData);
      const html = `
        <html>
          <head>
            <title>WhatsApp Bot - QR Code</title>
            <meta http-equiv="refresh" content="10">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px; background: #f0f0f0; }
              .container { background: white; padding: 30px; border-radius: 10px; display: inline-block; }
              img { max-width: 300px; }
              .status { margin-top: 20px; padding: 10px; border-radius: 5px; }
              .connected { background: #d4edda; color: #155724; }
              .disconnected { background: #f8d7da; color: #721c24; }
              .waiting { background: #fff3cd; color: #856404; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>WhatsApp Bot</h1>
              <h2>Scanne ce QR code avec WhatsApp</h2>
              <img src="${qrImage}" alt="QR Code">
              <div class="status ${connectionStatus === 'Connecté' ? 'connected' : connectionStatus === 'En attente de QR...' ? 'waiting' : 'disconnected'}">
                Statut: ${connectionStatus}
              </div>
              <p style="margin-top:20px; color:#666; font-size:14px;">
                La page se rafraîchit toutes les 10 secondes.<br>
                Si le QR change, c'est que Render a redémarré (normal sur le plan gratuit).
              </p>
            </div>
          </body>
        </html>
      `;
      res.send(html);
    } catch (err) {
      res.status(500).send('Erreur génération QR: ' + err.message);
    }
  } else {
    res.send(`
      <html>
        <head><title>WhatsApp Bot</title><meta http-equiv="refresh" content="5"></head>
        <body style="text-align:center; padding:40px; font-family:sans-serif;">
          <h1>En attente du QR code...</h1>
          <p>Le bot est en cours de démarrage. Rafraîchis dans quelques secondes.</p>
          <p>Statut: ${connectionStatus}</p>
        </body>
      </html>
    `);
  }
});

// Route healthcheck pour Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connection: connectionStatus });
});

async function startBot() {
  try {
    sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
      browser: ['Render Bot', 'Chrome', '1.0'],
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = qr;
        connectionStatus = 'En attente de QR...';
        console.log('QR code reçu, affichage sur le port', PORT);
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
          : true;

        console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        connectionStatus = 'Déconnecté - Reconnexion...';

        if (shouldReconnect) {
          setTimeout(startBot, 5000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        connectionStatus = 'Connecté';
        console.log('Connecté avec succès !');
      }
    });

    sock.ev.on('creds.update', saveState);

    // Gestion des messages entrants
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.key.fromMe && m.type === 'notify') {
        console.log('Message reçu:', msg.message?.conversation || msg.message?.extendedTextMessage?.text);
        // Ajoute ici ta logique de réponse
      }
    });

  } catch (err) {
    console.error('Erreur startBot:', err);
    setTimeout(startBot, 10000);
  }
}

// Démarrer Express ET le bot
app.listen(PORT, () => {
  console.log(`Serveur Express démarré sur le port ${PORT}`);
  console.log(`Ouvre https://ton-app-render.onrender.com/ pour voir le QR code`);
});

startBot();

