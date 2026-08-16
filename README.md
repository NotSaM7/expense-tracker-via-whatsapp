# WhatsApp Expense Tracker

A personal expense tracker that works entirely through WhatsApp. Send a message, get your spending tracked — no app required.

**Stack:** React · TypeScript · Vite · Node.js · Vercel Serverless · Supabase (PostgreSQL)

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A [Supabase](https://supabase.com) project (free tier works)
- A [Meta Developer](https://developers.facebook.com/) app with WhatsApp Cloud API access

---

## 1 · Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name, password, and region → **Create project**
3. Once ready, go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (secret) → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2 · Run the Schema

1. In your Supabase project, navigate to **Database → SQL editor → New query**
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql)
3. Click **Run**

This creates four tables: `accounts`, `transactions`, `budget`, `user_state`.

---

## 3 · Set Environment Variables Locally

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

WHATSAPP_TOKEN=your-whatsapp-bearer-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_VERIFY_TOKEN=any-random-secret-you-choose
MY_WHATSAPP_NUMBER=919876543210   # E.164 format, no + prefix
```

> ⚠️ **Never commit `.env.local`** — it is already in `.gitignore`.

---

## 4 · Run Locally

You need two terminals:

**Terminal 1 — Vercel dev server (serves /api routes):**

```bash
vercel dev
```

This reads `.env.local` automatically and runs your serverless functions locally on port 3000.

**Terminal 2 — Vite frontend:**

```bash
npm run dev
```

The Vite dev server proxies `/api/*` to `localhost:3000` (configured in `vite.config.ts`).

Open [http://localhost:5173](http://localhost:5173).

---

## 5 · Test the Database Connection

With both servers running, visit:

```
http://localhost:3000/api/test-db
```

You should get:

```json
{ "ok": true, "accounts": [] }
```

If you see an error, double-check your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

## 6 · Set Env Vars in Vercel

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add WHATSAPP_TOKEN
vercel env add WHATSAPP_PHONE_NUMBER_ID
vercel env add WHATSAPP_VERIFY_TOKEN
vercel env add MY_WHATSAPP_NUMBER
```

Or set them in the Vercel dashboard: **Project → Settings → Environment Variables**.

---

## 7 · Deploy to Vercel

```bash
vercel deploy
```

For production:

```bash
vercel --prod
```

After deploying, register your webhook URL in the Meta Developer Console:

```
https://your-project.vercel.app/api/webhook
```

Set the **Verify Token** to the same value as `WHATSAPP_VERIFY_TOKEN`.

---

## Project Structure

```
/
├── api/                  Vercel serverless functions (one file = one route)
│   ├── webhook.ts        POST/GET — WhatsApp webhook receiver
│   └── test-db.ts        GET  — Supabase connectivity smoke test
│
├── lib/                  Shared backend logic (imported by /api)
│   ├── supabase.ts       Typed Supabase client (service-role)
│   └── types.ts          TypeScript types for all DB tables
│
├── src/                  React frontend (Vite + TS)
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css         Dark theme design system
│
├── supabase/
│   └── schema.sql        Full PostgreSQL schema
│
├── vercel.json           Vercel build + function config
├── vite.config.ts        Vite config with /api proxy
├── tsconfig.json         Frontend TypeScript config
└── tsconfig.api.json     API/lib TypeScript config
```

---

## Roadmap

- [ ] WhatsApp message parser (amount · type · category extraction)
- [ ] Transaction CRUD logic in `/lib`
- [ ] Budget tracking and alerts
- [ ] Salary detection and confirmation flow
- [ ] Dashboard UI with charts and filters
- [ ] Monthly summary via WhatsApp
