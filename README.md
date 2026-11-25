# Duffel Playground

A local web page and Node server for testing the Duffel API in test mode.

- **Flights:** search offers, select one, book it (instant or hold), cancel it.
- **Stays:** search hotels, fetch rates, quote, book, cancel.
- **Payments:** create a Payment Intent, check it, confirm it.
- **Webhooks:** `/webhook` receives Duffel events, checks the signature, and shows them live on the page.
- **Live feed:** every API request and response also appears on the page. You do not need the terminal.

Your API key stays on the server. The browser never sees it.

## Run it

You need Node.js 18 or newer.

```bash
git clone https://github.com/sudhanz20/duffeltest.git
cd duffeltest
cp .env.example .env        # then put your duffel_test_ key in .env
npm install
npm start
```

Open **http://localhost:3000**.

The header shows "Test key" in green when the key is loaded. It shows "LIVE key" in red if you used a live token. Live tokens make real bookings and charges.

## Webhooks

Duffel cannot reach `localhost`. You need a public tunnel to your machine.

1. Keep `npm start` running. In a second terminal, start a tunnel:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   # or: ngrok http 3000
   ```
2. Copy the `https://…` URL the tunnel prints.
3. On the page, open **Webhook setup**, paste the URL, and click **Register webhook**.
   The server appends `/webhook`, subscribes to all event types, and writes the secret into `.env`.
   Duffel shows the secret only once, so this saves you copying it.
4. Click **List my webhooks**, then **Ping**. A `ping.triggered` event appears in the live feed with a green **verified** badge.

If you created the webhook in the Duffel dashboard instead, put its secret in `.env` as `DUFFEL_WEBHOOK_SECRET` and restart.

Free tunnel URLs change every time the tunnel restarts. Register the new URL and delete the old webhook.

### How verification works

Duffel sends `X-Duffel-Signature: t=<timestamp>,v1=<signature>`.
The server computes HMAC-SHA256 over `<timestamp>.<raw body>` with the secret, as hex, and compares in constant time.
Events with a bad or missing signature still show on the page, marked **UNVERIFIED**, and get a 401 reply.
Redelivered events (same `idempotency_key`) are marked **duplicate**.

## What needs account access

These were checked against a fresh test account on 25 Nov 2026:

| Feature | Works on a new test account? |
|---|---|
| Flights search, book, cancel | Yes |
| Webhooks | Yes |
| Stays | No. Returns 403 "feature is not enabled". Ask Duffel sales to enable it. |
| Payments (Payment Intents) | No. Returns 403 "Duffel Payments is not available". Ask help@duffel.com. |

The page shows these errors in full, so you can see exactly what Duffel returned.

## Test-mode tips

- Book **Duffel Airways (ZZ)** offers. They always book and cancel in test mode. The search puts them first.
- Stays test searches default to London (51.5071, -0.1416), where the "Duffel Test Hotel" sits.
- A Payment Intent needs a card attached in the browser with Duffel's card component, using the `client_token`. Until then, **Confirm** returns an error. That is expected.

## Files

- `server.js`: Express server, Duffel calls, webhook receiver, live feed (Server-Sent Events).
- `public/`: the page (`index.html`, `app.js`, `style.css`). No build step.
- `.env.example`: settings template. `.env` is git-ignored.
