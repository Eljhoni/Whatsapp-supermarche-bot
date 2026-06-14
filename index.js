const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const LIVREUR = '243901173598@s.whatsapp.net'; // ← REMPLACE PAR TON NUMÉRO LIVREUR

const MENU = [
  { id: 1, nom: '🍔 Burger Classique', prix: 3500 },
  { id: 2, nom: '🍟 Frites Maison', prix: 1500 },
  { id: 3, nom: '🍗 Poulet Pané', prix: 4500 },
  { id: 4, nom: '🥗 Salade César', prix: 3000 },
  { id: 5, nom: '🍕 Pizza Margherita', prix: 5000 },
  { id: 6, nom: '🥤 Coca 33cl', prix: 800 },
  { id: 7, nom: '🧃 Jus Naturel', prix: 1200 }
];

let qrCodeData = null;
let status = 'Démarrage...';
let sock = null;
let clients = {};
let commandes = [];

// Keep alive
setInterval(function() {
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    https.get('https://' + process.env.RENDER_EXTERNAL_HOSTNAME + '/health', function() {}).on('error', function() {});
  }
}, 2 * 60 * 1000);

// Express
app.get('/', async function(req, res) {
  if (qrCodeData) {
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send('<html><head><title>🍽️ Restaurant Bot</title><meta http-equiv="refresh" content="5"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#1a1a1a;color:white;}.box{background:#2d2d2d;padding:30px;border-radius:15px;display:inline-block;}img{max-width:280px;border-radius:10px;}.status{margin-top:20px;padding:12px;background:#ffc107;color:#000;font-weight:bold;border-radius:8px;}</style></head><body><div class="box"><h1>🍽️ Restaurant Bot</h1><h2>Scanne ce QR avec WhatsApp</h2><img src="' + qrImage + '" alt="QR"><div class="status">⏳ ' + status + '</div><p style="color:#aaa;">QR expire en ~20s, sois rapide !</p></div></body></html>');
  } else {
    res.send('<html><head><title>🍽️ Restaurant Bot</title><meta http-equiv="refresh" content="3"></head><body style="text-align:center;padding:40px;background:#1a1a1a;color:white;font-family:sans-serif;"><div style="background:#2d2d2d;padding:30px;border-radius:15px;display:inline-block;"><h1>🍽️ Restaurant Bot</h1><div style="padding:12px;background:#28a745;color:white;font-weight:bold;border-radius:8px;">✅ ' + status + '</div><p style="color:#aaa;">Bot actif et connecté !</p></div></body></html>');
  }
});

app.get('/health', function(req, res) {
  res.json({ ok: true, status: status, qr: !!qrCodeData, commandes: commandes.length });
});

// Bot
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

    sock.ev.on('connection.update', function(update) {
      const connection = update.connection;
      const lastDisconnect = update.lastDisconnect;
      const qr = update.qr;

      if (qr) {
        qrCodeData = qr;
        status = 'QR PRÊT - SCANNE !';
        console.log('>>> QR disponible');
      }

      if (connection === 'close') {
        qrCodeData = null;
        let shouldReconnect = true;
        if (lastDisconnect && lastDisconnect.error && lastDisconnect.error instanceof Boom) {
          if (lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut) {
            shouldReconnect = false;
          }
        }
        status = 'Reconnexion...';
        console.log('>>> Déconnecté, reconnect?', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(startBot, 5000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        status = 'CONNECTÉ !';
        console.log('>>> ✅ BOT CONNECTÉ !');
      }
    });

    sock.ev.on('messages.upsert', async function(m) {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || m.type !== 'notify') return;

      const from = msg.key.remoteJid;
      let text = '';
      if (msg.message && msg.message.conversation) {
        text = msg.message.conversation;
      } else if (msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) {
        text = msg.message.extendedTextMessage.text;
      }
      text = text.trim().toLowerCase();
      const name = msg.pushName || 'Client';

      console.log('>>> ' + name + ': ' + text);

      if (!clients[from]) {
        clients[from] = { panier: [], name: name };
      }
      const client = clients[from];

      // --- MENU ---
      if (text === 'menu') {
        let r = '🍽️ *RESTAURANT BOT*\n\n📋 *MENU*\n━━━━━━━━━━━━━━\n\n';
        for (let i = 0; i < MENU.length; i++) {
          r += MENU[i].id + '. ' + MENU[i].nom + '\n💰 ' + MENU[i].prix + ' FCFA\n\n';
        }
        r += '🛒 *commander [numéros]*\nEx: *commander 1,3,5*\n\n❓ *aide* pour plus d\'options';
        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- AIDE ---
      if (text === 'aide') {
        await sock.sendMessage(from, { text: '🤖 *COMMANDES*\n\n• *menu* - Voir le menu\n• *commander 1,2* - Ajouter au panier\n• *panier* - Voir le total\n• *valider* - Confirmer la commande\n• *annuler* - Vider le panier\n• *aide* - Cette page' });
        return;
      }

      // --- COMMANDER ---
      if (text.indexOf('commander') === 0) {
        const apres = text.replace('commander', '').trim();
        const parts = apres.split(/[,\s]+/);
        const nums = [];
        for (let i = 0; i < parts.length; i++) {
          const n = parseInt(parts[i]);
          if (!isNaN(n)) nums.push(n);
        }

        if (nums.length === 0) {
          await sock.sendMessage(from, { text: '❌ Format incorrect.\n\n✅ Exemple: *commander 1,3*\n\nTapez *menu* pour voir les numéros.' });
          return;
        }

        for (let i = 0; i < nums.length; i++) {
          for (let j = 0; j < MENU.length; j++) {
            if (MENU[j].id === nums[i]) {
              client.panier.push({ id: MENU[j].id, nom: MENU[j].nom, prix: MENU[j].prix });
              break;
            }
          }
        }

        let r = '✅ *Ajouté au panier :*\n';
        for (let i = 0; i < client.panier.length; i++) {
          r += '• ' + client.panier[i].nom + '\n';
        }
        r += '\n🛒 *panier* pour voir le total\n✅ *valider* pour confirmer';
        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- PANIER ---
      if (text === 'panier') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: '🛒 Votre panier est vide.\n\nTapez *menu* pour commander.' });
          return;
        }

        let total = 0;
        let r = '🛒 *VOTRE PANIER*\n━━━━━━━━━━━━━━\n\n';
        for (let i = 0; i < client.panier.length; i++) {
          r += (i + 1) + '. ' + client.panier[i].nom + '\n💰 ' + client.panier[i].prix + ' FCFA\n\n';
          total += client.panier[i].prix;
        }
        r += '━━━━━━━━━━━━━━\n💵 *TOTAL: ' + total + ' FCFA*\n\n✅ *valider* pour confirmer\n❌ *annuler* pour tout supprimer';

        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- ANNULER ---
      if (text === 'annuler') {
        client.panier = [];
        await sock.sendMessage(from, { text: '❌ Panier vidé.\n\nTapez *menu* pour recommencer.' });
        return;
      }

      // --- VALIDER ---
      if (text === 'valider') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: '❌ Votre panier est vide !\n\nTapez *menu* pour commander.' });
          return;
        }

        let total = 0;
        for (let i = 0; i < client.panier.length; i++) {
          total += client.panier[i].prix;
        }

        const id = Date.now().toString().slice(-6);
        const items = [];
        for (let i = 0; i < client.panier.length; i++) {
          items.push({ nom: client.panier[i].nom, prix: client.panier[i].prix });
        }

        const cmd = {
          id: id,
          client: from,
          name: client.name,
          items: items,
          total: total,
          date: new Date()
        };
        commandes.push(cmd);

        // Confirmation client
        await sock.sendMessage(from, { text: '🎉 *COMMANDE CONFIRMÉE !*\n\n🆔 N° : #' + id + '\n💵 Total : ' + total + ' FCFA\n\n⏳ Votre commande est en préparation...\n🚚 Le livreur vous contactera bientôt.\n\nMerci d\'avoir choisi notre restaurant ! 🙏' });

        // NOTIFICATION LIVREUR
        if (LIVREUR.indexOf('@') > 0) {
          let n = '🔔 *NOUVELLE COMMANDE !*\n\n🆔 Commande : #' + id + '\n👤 Client : ' + client.name + '\n📱 Numéro : ' + from.split('@')[0] + '\n\n📦 *DÉTAILS :*\n';
          for (let i = 0; i < items.length; i++) {
            n += '• ' + items[i].nom + ' - ' + items[i].prix + ' FCFA\n';
          }
          n += '\n💵 *TOTAL : ' + total + ' FCFA*\n⏰ ' + new Date().toLocaleString('fr-FR');

          try {
            await sock.sendMessage(LIVREUR, { text: n });
            console.log('>>> 📲 Livreur notifié #' + id);
          } catch (e) {
            console.log('>>> Erreur notif: ' + e.message);
          }
        }

        client.panier = [];
        return;
      }

      // --- ACCUEIL ---
      await sock.sendMessage(from, { text: '👋 Bienvenue chez notre restaurant !\n\n🍽️ Tapez *menu* pour voir le menu et commander\n❓ Tapez *aide* pour les commandes disponibles' });
    });

  } catch (err) {
    console.error('>>> ERREUR: ' + err.message);
    setTimeout(startBot, 10000);
  }
}

app.listen(PORT, function() {
  console.log('>>> 🚀 Bot restaurant port ' + PORT);
  startBot();
});
