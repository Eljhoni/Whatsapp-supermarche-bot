const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIG RESTAURANT ==========
const RESTAURANT = {
  nom: '🍽️ Le Délice Royal',
  slogan: 'Votre satisfaction, notre priorité !',
  livreur: '243991173598@s.whatsapp.net', // ← REMPLACE par le vrai numéro du livreur (format: 225XXXXXXXXX@s.whatsapp.net)
  devise: 'FCFA'
};

const MENU = [
  { id: 1, nom: '🍔 Burger Classique', prix: 3500, desc: 'Steak bœuf, fromage, laitue, tomate' },
  { id: 2, nom: '🍟 Frites Maison', prix: 1500, desc: 'Frites croustillantes, sauce au choix' },
  { id: 3, nom: '🍗 Poulet Pané', prix: 4500, desc: '2 morceaux, frites, coleslaw' },
  { id: 4, nom: '🥗 Salade César', prix: 3000, desc: 'Poulet grillé, parmesan, croûtons' },
  { id: 5, nom: '🍕 Pizza Margherita', prix: 5000, desc: 'Tomate, mozzarella, basilic frais' },
  { id: 6, nom: '🥤 Coca 33cl', prix: 800, desc: 'Boisson fraîche' },
  { id: 7, nom: '🧃 Jus Naturel', prix: 1200, desc: 'Ananas, gingembre, citron' }
];

// Stockage temporaire des commandes (en mémoire - sur Render gratuit ça suffit pour test)
const commandes = new Map();
const clients = new Map();

let qrCodeData = null;
let connectionStatus = 'Démarrage...';

// ========== EXPRESS ==========
app.get('/', async (req, res) => {
  if (qrCodeData) {
    try {
      const qrImage = await QRCode.toDataURL(qrCodeData);
      res.send(`
        <html>
          <head>
            <title>${RESTAURANT.nom}</title>
            <meta http-equiv="refresh" content="5">
            <style>
              body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; }
              .container { background: rgba(255,255,255,0.95); padding: 40px; border-radius: 20px; display: inline-block; color: #333; max-width: 400px; }
              img { max-width: 280px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
              .status { margin-top: 20px; padding: 15px; border-radius: 10px; background: #ffc107; color: #000; font-weight: bold; font-size: 16px; }
              h1 { color: #667eea; margin-bottom: 5px; }
              .slogan { color: #888; font-style: italic; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>${RESTAURANT.nom}</h1>
              <div class="slogan">${RESTAURANT.slogan}</div>
              <h2>Scanne ce QR code avec WhatsApp</h2>
              <img src="${qrImage}" alt="QR Code">
              <div class="status">⏳ ${connectionStatus}</div>
              <p style="color:#666; font-size:14px; margin-top:15px;">QR expire en ~20s, sois rapide !</p>
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
        <head><title>${RESTAURANT.nom}</title><meta http-equiv="refresh" content="3"></head>
        <body style="text-align:center; padding:40px; font-family:sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; min-height:100vh;">
          <div style="background:rgba(255,255,255,0.95); padding:40px; border-radius:20px; display:inline-block; color:#333;">
            <h1 style="color:#667eea;">${RESTAURANT.nom}</h1>
            <div style="padding:15px; background:#ffc107; color:#000; border-radius:10px; font-weight:bold; font-size:16px;">
              ⏳ ${connectionStatus}
            </div>
            <p style="color:#666; margin-top:15px;">En attente du QR code...</p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: connectionStatus, hasQR: !!qrCodeData, commandes: commandes.size });
});

// ========== FONCTIONS WHATSAPP ==========
function formatMenu() {
  let text = `╔══════════════════════╗\n`;
  text += `║  🍽️ *${RESTAURANT.nom}*  ║\n`;
  text += `╚══════════════════════╝\n\n`;
  text += `📋 *MENU DU JOUR*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  MENU.forEach(item => {
    text += `${item.id}. ${item.nom}\n`;
    text += `   💰 ${item.prix} ${RESTAURANT.devise}\n`;
    text += `   📝 ${item.desc}\n\n`;
  });
  
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `🛒 *Pour commander :*\n`;
  text += `Tapez : *commander [numéros]*\n`;
  text += `Exemple : *commander 1,3,6*\n\n`;
  text += `❓ Tapez *aide* pour plus d'options`;
  
  return text;
}

function formatPanier(panier) {
  let total = 0;
  let text = `🛒 *VOTRE PANIER*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  panier.forEach((item, idx) => {
    const plat = MENU.find(m => m.id === item.id);
    text += `${idx + 1}. ${plat.nom}\n`;
    text += `   💰 ${plat.prix} ${RESTAURANT.devise}\n\n`;
    total += plat.prix;
  });
  
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💵 *TOTAL : ${total} ${RESTAURANT.devise}*\n\n`;
  text += `✅ Tapez *valider* pour confirmer\n`;
  text += `❌ Tapez *annuler* pour tout supprimer`;
  
  return { text, total };
}

function formatCommandeLivreur(commande, clientJid, clientNom) {
  let text = `🔔 *NOUVELLE COMMANDE !*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `👤 Client : ${clientNom}\n`;
  text += `📱 Numéro : ${clientJid.split('@')[0]}\n`;
  text += `🆔 Commande : #${commande.id}\n\n`;
  text += `📦 *DÉTAILS :*\n`;
  
  commande.items.forEach(item => {
    const plat = MENU.find(m => m.id === item.id);
    text += `• ${plat.nom} - ${plat.prix} ${RESTAURANT.devise}\n`;
  });
  
  text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💵 *TOTAL : ${commande.total} ${RESTAURANT.devise}*\n`;
  text += `⏰ ${new Date().toLocaleString('fr-FR')}`;
  
  return text;
}

// ========== BOT WHATSAPP ==========
async function startBot() {
  console.log('>>> Démarrage bot restaurant...');
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = qr;
        connectionStatus = 'QR PRÊT - SCANNE !';
      }

      if (connection === 'close') {
        qrCodeData = null;
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
          : true;
        
        connectionStatus = 'Reconnexion...';
        if (shouldReconnect) setTimeout(startBot, 5000);
      } else if (connection === 'open') {
        qrCodeData = null;
        connectionStatus = 'CONNECTÉ !';
        console.log('>>> ✅ BOT RESTAURANT CONNECTÉ !');
      }
    });

    // ========== GESTION DES MESSAGES CLIENTS ==========
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || m.type !== 'notify') return;
      
      const from = msg.key.remoteJid;
      const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim().toLowerCase();
      const senderName = msg.pushName || 'Client';
      
      console.log(`>>> Message de ${senderName} (${from}): ${text}`);

      // Initialiser client si nouveau
      if (!clients.has(from)) {
        clients.set(from, { etape: 'accueil', panier: [], nom: senderName });
      }
      const client = clients.get(from);

      // ========== COMMANDE : MENU ==========
      if (text === 'menu') {
        await sock.sendMessage(from, { text: formatMenu() });
        client.etape = 'menu_vu';
        return;
      }

      // ========== COMMANDE : AIDE ==========
      if (text === 'aide' || text === 'help') {
        await sock.sendMessage(from, { text: 
          `🤖 *COMMANDES DISPONIBLES*\n\n` +
          `• *menu* - Voir le menu\n` +
          `• *commander [numéros]* - Ajouter au panier\n` +
          `   Ex: commander 1,3,6\n` +
          `• *panier* - Voir mon panier\n` +
          `• *valider* - Confirmer la commande\n` +
          `• *annuler* - Vider le panier\n` +
          `• *aide* - Cette page\n\n` +
          `📍 ${RESTAURANT.nom}`
        });
        return;
      }

      // ========== COMMANDE : COMMANDER ==========
      if (text.startsWith('commander')) {
        const nums = text.replace('commander', '').trim().split(/[,\s]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
        
        if (nums.length === 0) {
          await sock.sendMessage(from, { text: `❌ Format incorrect.\n\n✅ Exemple : *commander 1,3,6*\n\nTapez *menu* pour voir les numéros.` });
          return;
        }

        const ajoutes = [];
        const inconnus = [];
        
        nums.forEach(num => {
          const plat = MENU.find(m => m.id === num);
          if (plat) {
            client.panier.push({ id: num });
            ajoutes.push(plat.nom);
          } else {
            inconnus.push(num);
          }
        });

        let reponse = `✅ *Ajouté au panier :*\n`;
        ajoutes.forEach(nom => reponse += `• ${nom}\n`);
        
        if (inconnus.length > 0) {
          reponse += `\n❌ Numéros introuvables : ${inconnus.join(', ')}`;
        }
        
        reponse += `\n\n🛒 Tapez *panier* pour voir le total\n📦 Tapez *valider* pour confirmer`;
        
        await sock.sendMessage(from, { text: reponse });
        client.etape = 'panier';
        return;
      }

      // ========== COMMANDE : PANIER ==========
      if (text === 'panier') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: `🛒 Votre panier est vide.\n\nTapez *menu* pour commander.` });
          return;
        }
        
        const { text: panierText } = formatPanier(client.panier);
        await sock.sendMessage(from, { text: panierText });
        return;
      }

      // ========== COMMANDE : ANNULER ==========
      if (text === 'annuler') {
        client.panier = [];
        await sock.sendMessage(from, { text: `❌ Panier vidé.\n\nTapez *menu* pour recommencer.` });
        return;
      }

      // ========== COMMANDE : VALIDER ==========
      if (text === 'valider') {
        if (client.panier.length === 0) {
          await sock.sendMessage(from, { text: `❌ Votre panier est vide !\n\nTapez *menu* pour commander.` });
          return;
        }

        const { total } = formatPanier(client.panier);
        const commandeId = Date.now().toString().slice(-6);
        
        const commande = {
          id: commandeId,
          client: from,
          clientNom: client.nom,
          items: [...client.panier],
          total: total,
          date: new Date(),
          statut: 'confirmée'
        };
        
        commandes.set(commandeId, commande);

        // Confirmation client
        await sock.sendMessage(from, { text: 
          `🎉 *COMMANDE CONFIRMÉE !*\n\n` +
          `🆔 N° : #${commandeId}\n` +
          `💵 Total : ${total} ${RESTAURANT.devise}\n\n` +
          `⏳ Votre commande est en préparation...\n` +
          `🚚 Le livreur vous contactera bientôt.\n\n` +
          `Merci d'avoir choisi ${RESTAURANT.nom} ! 🙏`
        });

        // NOTIFICATION AU LIVREUR
        if (RESTAURANT.livreur && RESTAURANT.livreur.includes('@')) {
          try {
            await sock.sendMessage(RESTAURANT.livreur, { 
              text: formatCommandeLivreur(commande, from, client.nom) 
            });
            console.log(`>>> 📲 Notification livreur envoyée pour commande #${commandeId}`);
          } catch (err) {
            console.error('>>> Erreur notif livreur:', err.message);
          }
        }

        // Reset panier client
        client.panier = [];
        client.etape = 'accueil';
        return;
      }

      // ========== MESSAGE PAR DÉFAUT ==========
      if (client.etape === 'accueil') {
        await sock.sendMessage(from, { text: 
          `👋 Bienvenue chez *${RESTAURANT.nom}* !\n\n` +
          `🍽️ Pour voir notre menu, tapez :\n` +
          `*menu*\n\n` +
          `❓ Tapez *aide* pour les commandes`
        });
      }
    });

  } catch (err) {
    console.error('>>> ERREUR:', err.message);
    connectionStatus = 'Erreur: ' + err.message;
    setTimeout(startBot, 10000);
  }
}

// ========== DÉMARRAGE ==========
app.listen(PORT, () => {
  console.log(`>>> 🚀 ${RESTAURANT.nom} sur port ${PORT}`);
  startBot();
});
