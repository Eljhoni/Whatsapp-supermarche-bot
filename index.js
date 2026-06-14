const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIG ==========
const LIVREUR = '22507XXXXXXXXX@s.whatsapp.net'; // ← REMPLACE PAR TON NUMÉRO LIVREUR

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

// ========== KEEP ALIVE - RENDER NE DORT JAMAIS ==========
const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME;

setInterval(() => {
  if (RENDER_URL) {
    https.get(`https://${RENDER_URL}/health`, () => {
      console.log('>>> Keep-alive: OK');
    }).catch(() => {});
  }
  // Ping aussi le socket WhatsApp
  if (sock) {
    console.log('>>> Socket actif');
  }
}, 2 * 60 * 1000); // Toutes les 2 minutes

// ========== EXPRESS ==========
app.get('/', async (req, res) => {
  if (qrCodeData) {
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send(`
      <html>
        <head><title>Restaurant Bot</title><meta http-equiv="refresh" content="5">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px; background: #1a1a1a; color: white; }
          .box { background: #2d2d2d; padding: 30px; border-radius: 15px; display: inline-block; }
          img { max-width: 280px; border-radius: 10px; }
          .status { margin-top: 20px; padding: 12px; background: #ffc107; color: #000; font-weight: bold; border-radius: 8px; }
        </style></head>
        <body>
          <div class="box">
            <h1>🍽️ Restaurant Bot</h1>
            <h2>Scanne ce QR avec WhatsApp</h2>
            <img src="${qrImage}" alt="QR">
            <div class="status">${status}</div>
            <p style="color:#aaa; margin-top:15px;">Expire en 20s, sois rapide !</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head><title>Restaurant Bot</title><meta http-equiv="refresh" content="3"></head>
        <body style="text-align:center; padding:40px; background:#1a1a1a; color:white; font-family:sans-serif;">
          <div style="background:#2d2d2d; padding:30px; border-radius:15px; display:inline-block;">
            <h1>🍽️ Restaurant Bot</h1>
            <div style="padding:12px; background:#28a745; color:white; font-weight:bold; border-radius:8px;">
              ✅ ${status}
            </div>
            <p style="color:#aaa; margin-top:15px;">Bot actif et connecté !</p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status, qr: !!qrCodeData, commandes: commandes.length });
});

// ========== BOT WHATSAPP ==========
async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = qr;
        status = 'QR PRÊT - SCANNE !';
        console.log('>>> QR disponible');
      }

      if (connection === 'close') {
        qrCodeData = null;
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
          : true;
        
        status = 'Reconnexion...';
        console.log('>>> Déconnecté, reconnect?', shouldReconnect);

        if (shouldReconnect) {
          setTimeout(startBot, 3000);
        }
      } else if (connection === 'open') {
        qrCodeData = null;
        status = 'CONNECTÉ - BOT ACTIF';
        console.log('>>> ✅ BOT CONNECTÉ ET PRÊT');
      }
    });

    // ========== MESSAGES ==========
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || m.type !== 'notify') return;
      
      const from = msg.key.remoteJid;
      const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim().toLowerCase();
      const name = msg.pushName || 'Client';
      
      console.log(`>>> ${name}: ${text}`);

      if (!clients[from]) clients[from] = { panier: [], name };

      const client = clients[from];

      // --- MENU ---
      if (text === 'menu') {
        let r = `🍽️ *RESTAURANT BOT*\n\n📋 *MENU*\n━━━━━━━━━━━━━━\n\n`;
        MENU.forEach(p => {
          r += `${p.id}. ${p.nom}\n💰 ${p.prix} FCFA\n\n`;
        });
        r += `🛒 *commander 1,3,5*\n❓ *aide*`;
        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- AIDE ---
      if (text === 'aide') {
        await sock.sendMessage(from, { text: 
          `🤖 *COMMANDES*\n\n• menu\n• commander 1,2\n• panier\n• valider\n• annuler`
        });
        return;
      }

      // --- COMMANDER ---
      if (text.startsWith('commander')) {
        const nums = text.replace('commander', '').split(/[,\s]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
        
        if (nums.length === 0) {
          await sock.sendMessage(from, { text: `❌ Ex: *commander 1,3*` });
          return;
        }

        nums.forEach(num => {
          const plat = MENU.find(m => m.id === num);
          if (plat) client.panier.push(plat);
        });

        let r = `✅ *Ajouté :*\n`;
        client.panier.forEach(p => r += `• ${p.nom}\n`);
        r += `\n🛒 *panier* | ✅ *valider*`;
        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- PANIER ---
      if (text === 'panier') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: `🛒 Vide. Tapez *menu*.` });
          return;
        }
        
        let total = 0;
        let r = `🛒 *PANIER*\n━━━━━━━━━━━━━━\n\n`;
        client.panier.forEach((p, i) => {
          r += `${i+1}. ${p.nom}\n💰 ${p.prix} FCFA\n\n`;
          total += p.prix;
        });
        r += `━━━━━━━━━━━━━━\n💵 *TOTAL: ${total} FCFA*\n\n✅ *valider* | ❌ *annuler*`;
        
        await sock.sendMessage(from, { text: r });
        return;
      }

      // --- ANNULER ---
      if (text === 'annuler') {
        client.panier = [];
        await sock.sendMessage(from, { text: `❌ Annulé. Tapez *menu*.` });
        return;
      }

      // --- VALIDER ---
      if (text === 'valider') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: `❌ Vide ! *menu* pour commander.` });
          return;
        }

        let total = 0;
        client.panier.forEach(p => total += p.prix);

        const id = Date.now().toString().slice(-6);
        const cmd = { id, client: from, name: client.name, items: [...client.panier], total, date: new Date() };
        commandes.push(cmd);

        // Confirmation client
        await sock.sendMessage(from, { text: 
          `🎉 *COMMANDE #${id}*\n💵 ${total} FCFA\n⏳ En préparation...\n🚚 Livreur notifié !`
        });

        // NOTIF LIVREUR
        if (LIVREUR.includes('@')) {
          let n = `🔔 *COMMANDE #${id}*\n\n👤 ${client.name}\n📱 ${from.split('@')[0]}\n\n📦 *Détails:*\n`;
          cmd.items.forEach(p => n += `• ${p.nom} - ${p.prix} FCFA\n`);
          n += `\n💵 *TOTAL: ${total} FCFA*\n⏰ ${new Date().toLocaleString('fr-FR')}`;

          try {
            await sock.sendMessage(LIVREUR, { text: n });
            console.log(`>>> 📲 Livreur notifié #${id}`);
          } catch (e) {
            console.log('>>> Erreur notif:', e.message);
          }
        }

        client.panier = [];
        return;
      }

      // --- ACCUEIL ---
      await sock.sendMessage(from, { text: 
        `👋 *Bienvenue !*\n\n🍽️ *menu* pour commander\n❓ *aide* pour les commandes`
      });
    });

  } catch (err) {
    console.error('>>> ERREUR:', err.message);
    setTimeout(startBot, 10000);
  }
}

app.listen(PORT, () => {
  console.log(`>>> 🚀 Bot restaurant port ${PORT}`);
  startBot();
});

