# Weblancee Backend

Contact form API backend for the Weblancee portfolio website.

## Features
- Contact form submissions via POST `/api/contact`
- SMTP email notifications (Gmail)
- MongoDB Atlas storage for contact records
- CORS configured for Netlify frontend

## Environment Variables

Set these in your Render dashboard under **Environment**:

| Variable | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `your-email@gmail.com` |
| `SMTP_PASS` | `your-app-password` |
| `CONTACT_RECEIVER` | `your-email@gmail.com` |
| `MONGO_URI` | `mongodb+srv://...` |
| `MONGO_DB_NAME` | `weblancee` |

## Deployment
Deployed on [Render](https://render.com) as a Web Service.
