const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const LIVREUR = '243901173598@s.whatsapp.net';

const MENU = [
  { id: 1, nom: 'Burger Classique', prix: 3500 },
  { id: 2, nom: 'Frites Maison', prix: 1500 },
  { id: 3, nom: 'Poulet Pane', prix: 4500 },
  { id: 4, nom: 'Salade Cesar', prix: 3000 },
  { id: 5, nom: 'Pizza Margherita', prix: 5000 },
  { id: 6, nom: 'Coca 33cl', prix: 800 },
  { id: 7, nom: 'Jus Naturel', prix: 1200 }
];

let qrCodeData = null;
let status = 'Demarrage';
let sock = null;
let clients = {};
let commandes = [];

setInterval(() => {
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    https.get('https://' + process.env.RENDER_EXTERNAL_HOSTNAME + '/health', () => {}).catch(() => {});
  }
}, 2 * 60 * 1000);

app.get('/', async (req, res) => {
  if (qrCodeData) {
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send('<html><head><title>Bot</title><meta http-equiv="refresh" content="5"></head><body style="text-align:center;padding:40px;background:#1a1a1a;color:white;font-family:sans-serif;"><div style="background:#2d2d2d;padding:30px;border-radius:15px;display:inline-block;"><h1>Restaurant Bot</h1><h2>Scanne ce QR</h2><img src="' + qrImage + '" style="max-width:280px;border-radius:10px;"><div style="margin-top:20px;padding:12px;background:#ffc107;color:#000;font-weight:bold;border-radius:8px;">' + status + '</div></div></body></html>');
  } else {
    res.send('<html><head><title>Bot</title><meta http-equiv="refresh" content="3"></head><body style="text-align:center;padding:40px;background:#1a1a1a;color:white;font-family:sans-serif;"><div style="background:#2d2d2d;padding:30px;border-radius:15px;display:inline-block;"><h1>Bot Actif</h1><div style="padding:12px;background:#28a745;color:white;font-weight:bold;border-radius:8px;">' + status + '</div></div></body></html>');
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: status, qr: !!qrCodeData, commandes: commandes.length });
});

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version: version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = qr;
        status = 'QR PRET - SCANNE';
        console.log('QR dispo');
      }

      if (connection === 'close') {
        qrCodeData = null;
        const shouldReconnect = (lastDisconnect && lastDisconnect.error && lastDisconnect.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

        status = 'Reconnexion';
        console.log('Deconnecte, reconnect?', shouldReconnect);

        if (shouldReconnect) {
          setTimeout(startBot, 5000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        status = 'CONNECTE';
        console.log('BOT CONNECTE');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || m.type !== 'notify') return;

      const from = msg.key.remoteJid;
      const text = (msg.message && msg.message.conversation ? msg.message.conversation : (msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.text ? msg.message.extendedTextMessage.text : '')).trim().toLowerCase();
      const name = msg.pushName || 'Client';

      console.log(name + ': ' + text);

      if (!clients[from]) clients[from] = { panier: [], name: name };

      const client = clients[from];

      if (text === 'menu') {
        let r = 'RESTAURANT BOT\n\nMENU\n==========\n\n';
        MENU.forEach(function(p) {
          r += p.id + '. ' + p.nom + '\n' + p.prix + ' FCFA\n\n';
        });
        r += 'commander 1,3,5\naide';
        await sock.sendMessage(from, { text: r });
        return;
      }

      if (text === 'aide') {
        await sock.sendMessage(from, { text: 'COMMANDES:\n\nmenu\ncommander 1,2\npanier\nvalider\nannuler' });
        return;
      }

      if (text.indexOf('commander') === 0) {
        const nums = text.replace('commander', '').split(/[,\s]+/).map(function(n) { return parseInt(n); }).filter(function(n) { return !isNaN(n); });

        if (nums.length === 0) {
          await sock.sendMessage(from, { text: 'Ex: commander 1,3' });
          return;
        }

        nums.forEach(function(num) {
          const plat = MENU.find(function(m) { return m.id === num; });
          if (plat) client.panier.push(plat);
        });

        let r = 'Ajoute:\n';
        client.panier.forEach(function(p) {
          r += p.nom + '\n';
        });
        r += '\npanier | valider';
        await sock.sendMessage(from, { text: r });
        return;
      }

      if (text === 'panier') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: 'Panier vide. Tapez menu.' });
          return;
        }

        let total = 0;
        let r = 'PANIER\n==========\n\n';
        client.panier.forEach(function(p, i) {
          r += (i + 1) + '. ' + p.nom + '\n' + p.prix + ' FCFA\n\n';
          total += p.prix;
        });
        r += '==========\nTOTAL: ' + total + ' FCFA\n\nvalider | annuler';

        await sock.sendMessage(from, { text: r });
        return;
      }

      if (text === 'annuler') {
        client.panier = [];
        await sock.sendMessage(from, { text: 'Annule. Tapez menu.' });
        return;
      }

      if (text === 'valider') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: 'Vide! Tapez menu.' });
          return;
        }

        let total = 0;
        client.panier.forEach(function(p) {
          total += p.prix;
        });

        const id = Date.now().toString().slice(-6);
        const cmd = { id: id, client: from, name: client.name, items: client.panier.slice(), total: total, date: new Date() };
        commandes.push(cmd);

        await sock.sendMessage(from, { text: 'COMMANDE #' + id + '\n' + total + ' FCFA\nEn preparation...\nLivreur notifie!' });

        if (LIVREUR.indexOf('@') > 0) {
          let n = 'NOUVELLE COMMANDE #' + id + '\n\n' + client.name + '\n' + from.split('@')[0] + '\n\nDETAILS:\n';
          cmd.items.forEach(function(p) {
            n += p.nom + ' - ' + p.prix + ' FCFA\n';
          });
          n += '\nTOTAL: ' + total + ' FCFA\n' + new Date().toLocaleString('fr-FR');

          try {
            await sock.sendMessage(LIVREUR, { text: n });
            console.log('Notif livreur ' + id);
          } catch (e) {
            console.log('Erreur notif: ' + e.message);
          }
        }

        client.panier = [];
        return;
      }

      await sock.sendMessage(from, { text: 'Bienvenue!\n\nmenu pour commander\naide pour les commandes' });
    });

  } catch (err) {
    console.error('ERREUR: ' + err.message);
    setTimeout(startBot, 10000);
  }
}

app.listen(PORT, function() {
  console.log('Bot port ' + PORT);
  startBot();
});
