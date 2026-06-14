const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const qrcode = require('qrcode-terminal')

const app = express()
const port = process.env.PORT || 3000

// Pour UptimeRobot - garde Render éveillé
app.get('/', (req, res) => res.send('Bot Supermarché actif'))
app.listen(port, () => console.log(`Serveur lancé sur port ${port}`))

// Ta liste de produits - modifie comme tu veux
const PRODUITS = {
    'riz': { prix: 2500, stock: 50, unite: 'kg' },
    'huile': { prix: 4000, stock: 30, unite: 'L' },
    'sucre': { prix: 1800, stock: 100, unite: 'kg' },
    'farine': { prix: 2200, stock: 80, unite: 'kg' }
}

const PHONE_NUMBER = '243901173598' // Ton numéro sans +

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Supermarche Bot', 'Chrome', '1.0.0']
    })

    sock.ev.on('creds.update', saveCreds)

    // Demande le code au 1er lancement
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER)
                console.log('====================================')
                console.log('CODE WHATSAPP:', code)
                console.log('====================================')
                console.log('Va dans WhatsApp → Appareils liés → Lier avec numéro')
            } catch (e) {
                console.log('Erreur code:', e.message)
            }
        }, 3000)
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if(qr) {
            console.log('QR reçu mais on utilise le code. Check les logs plus haut.')
        }
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode!== DisconnectReason.loggedOut
            console.log('Connexion fermée. Reconnexion:', shouldReconnect)
            if(shouldReconnect) startBot()
        }
        if(connection === 'open') {
            console.log('✅ Bot Supermarché connecté sur +243901173598')
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if(!m.message || m.key.fromMe) return

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').toLowerCase().trim()
        const sender = m.key.remoteJid

        if(text === 'menu' || text === 'bonjour' || text === 'salut') {
            let menu = '*🛒 SUPERMARCHÉ - Bienvenue*\n\n*Liste des prix:*\n'
            for(let p in PRODUITS) {
                menu += `- ${p} : ${PRODUITS[p].prix} FC/${PRODUITS[p].unite}\n`
            }
            menu += '\n*Commandes rapides:*\n'
            menu += 'prix riz\nstock huile\ncommander 2kg riz\n\nNous livrons à Lubumbashi'
            await sock.sendMessage(sender, { text: menu })
        }

        else if(text.startsWith('prix ')) {
            const produit = text.split(' ')[1]
            if(PRODUITS[produit]) {
                await sock.sendMessage(sender, {
                    text: `*${produit.toUpperCase()}*\nPrix: ${PRODUITS[produit].prix} FC/${PRODUITS[produit].unite}\nStock: ${PRODUITS[produit].stock} dispo`
                })
            } else {
                await sock.sendMessage(sender, { text: 'Produit introuvable 😕\nTape "menu" pour voir la liste' })
            }
        }

        else if(text.startsWith('stock ')) {
            const produit = text.split(' ')[1]
            if(PRODUITS[produit]) {
                await sock.sendMessage(sender, { text: `Stock ${produit}: ${PRODUITS[produit].stock} ${PRODUITS[produit].unite}` })
            }
        }

        else if(text.startsWith('commander ')) {
            await sock.sendMessage(sender, {
                text: '✅ *Commande enregistrée*\n\nOn prépare ça tout de suite.\nLivraison en 1h sur Lubumbashi.\nPaiement cash ou mobile money à la livraison.\n\nMerci 🙏'
            })
            // Ici tu peux ajouter l'envoi de la commande sur ton propre numéro
            console.log(`Nouvelle commande de ${sender}: ${text}`)
        }
    })
}

startBot()
