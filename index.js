const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const qrcode = require('qrcode')

const app = express()
const port = process.env.PORT || 3000

let latestQR = null

app.get('/', (req, res) => {
    if (latestQR) {
        res.send(`<h2>Scanne ce QR avec WhatsApp</h2><img src="${latestQR}"><p>Si ça expire, refresh la page</p>`)
    } else {
        res.send('Bot actif. En attente du QR...')
    }
})

app.listen(port, () => console.log(`Serveur lancé sur port ${port}`))

const PRODUITS = {
    'riz': { prix: 2500, stock: 50, unite: 'kg' },
    'huile': { prix: 4000, stock: 30, unite: 'L' },
    'sucre': { prix: 1800, stock: 100, unite: 'kg' },
    'farine': { prix: 2200, stock: 80, unite: 'kg' }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Supermarche Bot', 'Chrome', '1.0.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            latestQR = await qrcode.toDataURL(qr)
            console.log('Nouveau QR généré. Ouvre ton URL Render pour scanner')
        }
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode!== DisconnectReason.loggedOut
            if(shouldReconnect) startBot()
        }
        if(connection === 'open') {
            console.log('✅ Bot Supermarché connecté sur +243901173598')
            latestQR = null
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
            menu += '\n*Commandes:*\nprix riz\ncommander 2kg riz'
            await sock.sendMessage(sender, { text: menu })
        }
        else if(text.startsWith('prix ')) {
            const produit = text.split(' ')[1]
            if(PRODUITS[produit]) {
                await sock.sendMessage(sender, { text: `*${produit}*\nPrix: ${PRODUITS[produit].prix} FC/${PRODUITS[produit].unite}` })
            }
        }
    })
}

startBot()
