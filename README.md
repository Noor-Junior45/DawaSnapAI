# DawaSnap AI: Smart Medicine Tracker & Scanner

DawaSnap AI is a privacy-first medication management platform and prescription scanner featuring on-device OCR, multi-batch expiry tracking, drug interaction analysis, and bidirectional cloud synchronization between **Firebase Firestore** and **Supabase (PostgreSQL)**.

---

## 📖 Claude & External Database Integrations

If you are **Claude**, an AI agent, or an external engineer working with the **Supabase** backend, read the comprehensive integration specification before modifying data:

👉 **[`FIREBASE_SUPABASE_INTEGRATION_SPEC.md`](./FIREBASE_SUPABASE_INTEGRATION_SPEC.md)**

This document details:
- Firestore Document Paths ⇄ Supabase PostgreSQL Table Mappings
- Field conversions (camelCase vs. snake_case, ISO timestamps vs. Epoch milliseconds)
- Primary keys and user scoping (`user_id` / `userId`)
- Strict validation rules required when writing to Supabase so that data syncs cleanly back into Firebase Firestore
- Synchronization endpoints (`/api/backup/pull-from-supabase`, `/api/backup/two-way-sync`)

---

## 🛠 Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Motion
- **Native Android / Mobile**: Capacitor 7, LocalNotifications, PushNotifications, Splash Screen
- **Primary Live Database & Auth**: Google Cloud Firestore & Firebase Authentication
- **SQL Backup & Analytics**: Supabase PostgreSQL
- **Backend**: Express on Node.js / tsx

---

## 🚀 Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

---

## 📄 License & Compliance

Compliant with DPDP Act 2023 & Google API Services User Data Policy. Zero cloud photo storage (OCR and medicine photos remain strictly on-device).
