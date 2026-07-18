const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// CORS — allow Netlify frontend + localhost for development
const allowedOrigins = [
  'https://weblancee.netlify.app',
  'https://weblancin.in',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Weblancee backend is running. Use POST /api/contact to submit contact messages.' });
});

let lastError = null;

app.get('/api/logs', (req, res) => {
  res.json({ lastError });
});

let pgPool;
let dbConnected = false;

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn('WARNING: DATABASE_URL is not defined. Running without database support.');
    return;
  }

  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pgPool.connect();
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    dbConnected = true;
    console.log('Successfully connected to Neon DB (PostgreSQL) and ensured contacts table exists.');
  } catch (error) {
    console.error('WARNING: Could not connect to Neon DB.');
    console.error('Error Details:', error.message);
    console.log('Server will continue running with SMTP email fallback only.');
  }
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: 465, // Force 465 (SMTPS) since Render blocks port 587
  secure: true, // Port 465 requires secure: true
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Timeouts to prevent hanging on cold starts / slow SMTP
  connectionTimeout: 10000, // 10s to establish TCP connection
  greetingTimeout: 10000,   // 10s for SMTP server greeting
  socketTimeout: 15000,     // 15s for socket inactivity
  pool: true,               // Reuse SMTP connections
  maxConnections: 3,
  maxMessages: 50,
});

// Verify SMTP connection on startup so the pool is warm
transporter.verify()
  .then(() => console.log('SMTP transporter verified — ready to send emails'))
  .catch((err) => console.warn('SMTP verification failed (will retry on first send):', err.message));

// Health endpoint for uptime monitors (e.g. UptimeRobot) to keep Render awake
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: dbConnected, timestamp: new Date().toISOString() });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !phone || !message) {
    return res.status(400).json({ error: 'Name, email, phone, and message are required.' });
  }

  const mailOptions = {
    from: `Weblancee Contact Form <${process.env.SMTP_USER}>`,
    replyTo: `${name} <${email}>`,
    to: process.env.CONTACT_RECEIVER,
    subject: `New contact from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\n\nMessage:\n${message}`,
    html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Phone:</strong> ${phone}</p><p><strong>Message:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`,
  };

  try {
    // Save to DB — isolate so DB failure doesn't block email
    if (dbConnected && pgPool) {
      try {
        const query = 'INSERT INTO contacts (name, email, phone, message) VALUES ($1, $2, $3, $4)';
        await pgPool.query(query, [name, email, phone, message]);
        console.log('Saved contact submission to Neon DB');
      } catch (dbErr) {
        console.error('Neon DB insert failed (continuing with email):', dbErr.message);
      }
    } else {
      console.log('Database not connected. Skipping Neon DB insert.');
    }

    // Send email with one retry on transient failure
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await transporter.sendMail(mailOptions);
        console.log('Email sent via SMTP to', process.env.CONTACT_RECEIVER, `(attempt ${attempt})`);
        return res.json({ success: true, message: 'Message sent successfully.' });
      } catch (smtpErr) {
        console.error(`SMTP attempt ${attempt} failed:`, smtpErr.message);
        if (attempt === 2) throw smtpErr;
        // Brief pause before retry
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    lastError = { message: error.message, stack: error.stack, time: new Date().toISOString() };
    console.error('Error in contact endpoint:', error.message);
    return res.status(500).json({ error: 'Failed to send message. Please try again later.', details: error.message });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Weblancee backend running on port ${port}`);
    initializeDatabase();
  });
} else {
  // In production (Vercel), initialize database but don't bind to a port
  initializeDatabase();
}

module.exports = app;
