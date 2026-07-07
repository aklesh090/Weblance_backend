
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'weblancee.in@gmail.com',
    pass: 'invx yzow yxyo lvap',
  },
  connectionTimeout: 10000,
});

transporter.verify()
  .then(() => {
    console.log('SMTP connection successful!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('SMTP connection failed:', err);
    process.exit(1);
  });
