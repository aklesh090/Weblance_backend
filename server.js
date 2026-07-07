const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
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

let contactsCollection;
let dbConnected = false;

async function initializeDatabase() {
  if (!process.env.MONGO_URI) {
    console.warn('WARNING: MONGO_URI is not defined. Running without database support.');
    return;
  }

  try {
    const client = new MongoClient(process.env.MONGO_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    const db = client.db(process.env.MONGO_DB_NAME || 'weblancee');
    contactsCollection = db.collection('contacts');
    dbConnected = true;
    console.log('Successfully connected to MongoDB Atlas');
  } catch (error) {
    console.error('WARNING: Could not connect to MongoDB Atlas.');
    console.error('Error Details:', error.message);
    console.log('Server will continue running with SMTP email fallback only.');
  }
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
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
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const contactRecord = {
    name,
    email,
    message,
    createdAt: new Date(),
  };

  const mailOptions = {
    from: `Weblancee Contact Form <${process.env.SMTP_USER}>`,
    replyTo: `${name} <${email}>`,
    to: process.env.CONTACT_RECEIVER,
    subject: `New contact from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`,
  };

  try {
    // Save to DB — isolate so DB failure doesn't block email
    if (dbConnected && contactsCollection) {
      try {
        await contactsCollection.insertOne(contactRecord);
        console.log('Saved contact submission to MongoDB');
      } catch (dbErr) {
        console.error('MongoDB insert failed (continuing with email):', dbErr.message);
      }
    } else {
      console.log('Database not connected. Skipping MongoDB insert.');
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

app.listen(port, () => {
  console.log(`Weblancee backend running on port ${port}`);
  initializeDatabase();
});
