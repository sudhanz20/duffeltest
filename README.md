# Nomad

A flight search and booking app built on the Duffel API. It runs in Duffel test mode.

## What it does

- **Search.** Airport and city lookup, a date-range calendar, one way or return.
- **Travellers.** Adults, children with their ages, and infants on a lap. Up to 9 people.
- **Frequent flyer.** Add loyalty numbers per adult. Airlines may return member fares.
- **Cabins.** Economy, Premium, Business, First, or Any. You can also pick a different cabin each way.
- **Sorting.** Recommended, Comfort, Cheapest, Fastest and Greenest (lowest CO₂). The lowest-emission flights get a green leaf.
- **Filters.** Stops, price, departure and arrival time sliders each way, journey time, checked bags, cabin bag, refundable, changeable, Wi‑Fi, free Wi‑Fi, power, extra legroom, flat bed, private suite, priority boarding and check-in, seat selection, frequent flyer programme, and airline. All come from Duffel offer data. Ask Nomad understands all of them.
- **Not available:** meals, Starlink or other Wi‑Fi providers, lounges and alliances. Duffel offers do not include this data.
- **Ask Nomad.** Describe a trip in plain words. Claude fills in the search, flags every guess, and asks about anything missing. You correct it in words or in the form, then search.
- **Recent searches.** Saved in your browser and shown on the home page.
- **Checkout.** Traveller details with passport-name and age checks, then a payment page.
- **Payment methods.** Card, Apple Pay, Google Pay, PayPal, Pay later and Agency balance.
- **My bookings.** Look up by reference and last name, or see every booking.
- **Manage booking.** Pay for a held booking, change a flight's date or cabin, cancel with a refund quote, and request a name correction.
- **Developer drawer.** A live feed of every Duffel call and webhook, plus webhook setup.

## What is real and what is simulated

| Feature | Status |
|---|---|
| Search, booking, hold and pay later, date and cabin changes, cancellation | Real Duffel API calls in test mode |
| Card, Apple Pay, Google Pay, PayPal | Simulated. Every method settles from your Duffel test balance. |
| Name corrections | Simulated. Duffel's API cannot rename a passenger; airlines do it by hand. Nomad stores the request in your browser. |
| Ask Nomad | Real Claude API call. Uses `claude-haiku-5-5`, the cheapest model, unless you set `ANTHROPIC_MODEL`. Needs `ANTHROPIC_API_KEY`. Without it the tab shows a notice and the classic search still works. |
| Mixed cabins (for example Business out, Economy back) | Real, but sold as two one-way tickets with two booking references. Airlines rarely sell this as one ticket. If the second ticket fails, Nomad cancels the first. |

Book **Duffel Airways** flights in test mode. They book, change and cancel reliably. Other airlines can fail in test mode.

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

## Deploy on Vercel

1. In Vercel, click **Add New → Project** and import this repository. Keep the defaults.
2. Add these environment variables before you deploy:
   - `DUFFEL_API_KEY`: your `duffel_test_…` token.
   - `PLAYGROUND_PASSWORD`: any password. Without it, anyone with the URL can book on your Duffel account.
   - `ANTHROPIC_API_KEY` (optional): turns on Ask Nomad. Each request is one Claude call.
   - `ANTHROPIC_MODEL` (optional): the Claude model for Ask Nomad. Default `claude-haiku-5-5`.
3. Deploy and open the URL. Any username works with the password.

## Duffel supplier KPIs

Nomad can record how Duffel performs for it: search time, error rate, order success, searches per booking (Duffel charges above 1,500), expired offers, price changes at booking, offers per route, held orders paid, cancellations and refunds, airline schedule changes and webhooks.

It stores daily totals in Redis and keeps them for about 400 days. Test and live traffic are stored apart. Recording never slows or breaks a booking.

To turn it on:

1. In Vercel, open the project, then **Storage → Create → Upstash for Redis** (the free plan is enough) and connect it to this project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. Redeploy.
3. Open **Developer → Supplier KPIs**, or go to `/kpis.html`. The JSON is at `/api/kpis?days=30&mode=test`.

Locally, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env`. Without them, nothing is recorded.

## Webhooks

Open **Developer → Webhooks**.

- **On Vercel**, the URL is filled in. Click **Register webhook**. Copy `secret` from the live feed into the `DUFFEL_WEBHOOK_SECRET` setting, then redeploy.
- **Locally**, Duffel cannot reach `localhost`. Run `npx cloudflared tunnel --url http://localhost:3000`, paste the https URL, and register. The secret is saved to `.env` for you.

Then click **Ping**. A `ping.triggered` event appears in the live feed, marked **verified**.

The server checks `X-Duffel-Signature` (HMAC-SHA256 over `<timestamp>.<raw body>`). Events that fail the check still show, marked **UNVERIFIED**, and get a 401.

**Known limit on Vercel:** the live feed lives in server memory. Vercel can run several copies of the server, so a webhook can land on a copy your page is not connected to. If events go missing, run locally or add a shared store such as Redis.

## Files

- `ai.js`: Ask Nomad. Sends the request to Claude, checks the answer, and looks up the airports.
- `metrics.js`: Duffel supplier KPIs. Records daily totals in Redis and reads the trends back.
- `server.js`: Express server. Duffel calls, search scoring, bookings, changes, cancellations, webhooks, live feed.
- `public/index.html`: page shell.
- `public/css/nomad.css`: the Nomad design.
- `public/js/`: `search.js` (home and search form), `ai.js` (Ask Nomad), `calendar.js`, `results.js`, `checkout.js`, `trips.js` (My bookings and Manage booking), `kpis.js` (Supplier KPIs page), `dev.js`, `state.js`, `util.js`.

Photos come from Unsplash. Airline logos come from Duffel.
