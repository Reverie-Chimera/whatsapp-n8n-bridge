const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

if (!N8N_WEBHOOK_URL) {
    console.error('N8N_WEBHOOK_URL environment variable is required');
    process.exit(1);
}

// WhatsApp client setup
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// QR Code generation
client.on('qr', (qr) => {
    console.log('='.repeat(50));
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP:');
    console.log('='.repeat(50));
    qrcode.generate(qr, { small: true });
    console.log('='.repeat(50));
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp Client authenticated');
});

client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Client was logged out:', reason);
});

// Handle incoming messages
client.on('message', async (msg) => {
    try {
        // Skip status messages and groups for now
        if (msg.from === 'status@broadcast' || msg.from.includes('@g.us')) {
            return;
        }

        console.log(`📨 Message from ${msg.from}: ${msg.body}`);

        // Get contact info
        const contact = await msg.getContact();
        
        // Prepare data for n8n
        const messageData = {
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp,
            contactName: contact.name || contact.pushname || 'Unknown',
            responseUrl: `${process.env.RAILWAY_STATIC_URL || 'http://localhost:' + PORT}`
        };

        // Send to n8n
        const response = await axios.post(N8N_WEBHOOK_URL, messageData, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Message sent to n8n successfully');

    } catch (error) {
        console.error('❌ Error processing message:', error.message);
        
        // Send error response
        try {
            await msg.reply('Sorry, I encountered an error processing your message. Please try again.');
        } catch (replyError) {
            console.error('❌ Error sending error reply:', replyError.message);
        }
    }
});

// Express middleware
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'running',
        whatsappReady: client.info ? true : false,
        timestamp: new Date().toISOString()
    });
});

// Reply endpoint for n8n to send responses back
app.post('/reply', async (req, res) => {
    try {
        const { to, message } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ error: 'Missing "to" or "message" in request body' });
        }

        console.log(`📤 Sending reply to ${to}: ${message}`);
        
        await client.sendMessage(to, message);
        
        console.log('✅ Reply sent successfully');
        res.json({ success: true, message: 'Reply sent successfully' });

    } catch (error) {
        console.error('❌ Error sending reply:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Initialize WhatsApp client
console.log('🚀 Starting WhatsApp-n8n bridge...');
client.initialize();

// Start Express server
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    await client.destroy();
    process.exit(0);
});

