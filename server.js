const express = require('express');
const dotenv = require('dotenv');
const { processCombinedMessages } = require('./sendMessage');
const ConfigManager = require('./config');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const qrcode = require('qrcode-terminal');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

app.use(express.json());

// WhatsApp client singleton
let waClient = null;
let waReady = false;
let waInitPromise = null;

async function getWhatsAppClient() {
  if (waClient && waReady) return waClient;
  if (waInitPromise) return waInitPromise;

  const config = new ConfigManager();
  waClient = new Client({
    authStrategy: new LocalAuth({
      clientId: config.teamMember,
      dataPath: path.join(process.cwd(), '.wwebjs_auth')
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  // Add QR code event handler
  waClient.on('qr', (qr) => {
    console.log('\n📲 Scan this QR code with your WhatsApp mobile app:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⏳ Waiting for QR code scan...\n');
  });

  waInitPromise = new Promise((resolve, reject) => {
    waClient.on('ready', () => {
      waReady = true;
      console.log('✅ WhatsApp client is ready!');
      resolve(waClient);
    });
    waClient.on('auth_failure', (err) => {
      waReady = false;
      waInitPromise = null;
      reject(new Error('WhatsApp authentication failed: ' + err));
    });
    waClient.on('disconnected', () => {
      waReady = false;
      waInitPromise = null;
    });
    waClient.initialize();
  });

  return waInitPromise;
}

// Bearer token auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!API_TOKEN) return res.status(500).json({ error: 'API_TOKEN not set in .env' });
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.split(' ')[1];
  if (token !== API_TOKEN) {
    return res.status(403).json({ error: 'Invalid API token' });
  }
  next();
}

app.post('/send-now', requireAuth, async (req, res) => {
  const mode = (req.body.mode || 'combined').toLowerCase();
  let options;
  if (mode === 'instant') {
    options = { instantMode: true, scheduledMode: false, combinedMode: false };
  } else if (mode === 'scheduled') {
    options = { instantMode: false, scheduledMode: true, combinedMode: false };
  } else {
    options = { instantMode: false, scheduledMode: false, combinedMode: true };
  }

  try {
    const wa = await getWhatsAppClient();
    if (!waReady) return res.status(503).json({ error: 'WhatsApp client not ready' });
    const config = new ConfigManager();
    const result = await processCombinedMessages(wa, config.messagesSheet, options);
    res.json({ success: true, mode, result });
  } catch (err) {
    console.error('❌ Error in /send-now:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.get('/', (req, res) => {
  res.send('WhatsApp Scheduler Bot API is running. POST /send-now to trigger message sending.');
});

app.listen(PORT, () => {
  console.log(`🚀 REST API server running on port ${PORT}`);
}); 