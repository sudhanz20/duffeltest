# Duffel Flights Playground

A small web page and Node server for testing Duffel flights in test mode.

- Search offers, select one, book it (instant or hold), and cancel it.
- Receive Duffel webhooks at `/webhook`, check the signature, and show them live on the page.
- See every API request and response on the page. You do not need the terminal.

Your API key stays on the server. The browser never sees it.

## Deploy on Vercel

1. In Vercel, click **Add New → Project** and import `sudhanz20/duffeltest`. Keep the defaults. Vercel detects Express.
2. Before you deploy, add these **Environment Variables**:
   - `DUFFEL_API_KEY`: your `duffel_test_…` token.
   - `PLAYGROUND_PASSWORD`: any password. Without it, anyone with the URL can book on your Duffel account.
3. Click **Deploy**, then open the URL. The browser asks for a password. Any username works.
4. Open **Webhook setup**. The URL is already filled in, so you need no tunnel. Click **Register webhook**.
5. Duffel shows the webhook secret only once. Copy `secret` from the response in the live feed.
   Add it in Vercel as `DUFFEL_WEBHOOK_SECRET`, then redeploy.
6. Click **List my webhooks**, then **Ping**. A `ping.triggered` event appears with a green **verified** badge.

### Known limit on Vercel

The live feed lives in server memory. Vercel can run more than one copy of the server.
If a webhook lands on a different copy than the one your page is connected to, you will not see it.
For one person testing, this is usually fine. If events go missing, run it locally, or add a shared store such as Redis.

## Run locally

You need Node.js 18 or newer.

```bash
git clone https://github.com/sudhanz20/duffeltest.git
cd duffeltest
cp .env.example .env        # then put your duffel_test_ key in .env
npm install
npm start
```

Open **http://localhost:3000**.

Duffel cannot reach `localhost`, so webhooks need a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

Paste the `https://…` URL into **Webhook setup** and click **Register webhook**.
Locally, the server writes the secret into `.env` for you.
Free tunnel URLs change every restart. Register the new URL and delete the old webhook.

## How webhook verification works

Duffel sends `X-Duffel-Signature: t=<timestamp>,v1=<signature>`.
The server computes HMAC-SHA256 over `<timestamp>.<raw body>` with the secret, as hex, and compares in constant time.
Events with a bad or missing signature still show on the page, marked **UNVERIFIED**, and get a 401 reply.
Redelivered events (same `idempotency_key`) are marked **duplicate**.

## Test-mode tips

- Book **Duffel Airways (ZZ)** offers. They always book and cancel in test mode. The search lists them first.
- The header shows "Test key" in green when the key is loaded. It shows "LIVE key" in red for a live token, which makes real bookings.

## Files

- `server.js`: Express server, Duffel calls, webhook receiver, live feed (Server-Sent Events). Exports the app for Vercel.
- `public/`: the page (`index.html`, `app.js`, `style.css`). No build step.
- `.env.example`: settings template. `.env` is git-ignored.
