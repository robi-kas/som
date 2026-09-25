# New Chapter Cafe POS

A complete point-of-sale system for a cafe in Ethiopia: waiters take orders on their phones, the
kitchen, coffee bar and juice bar each get their own screen and printer, the cashier takes cash,
Telebirr and bank transfers, and the owner sees everything in one place.

Built for real service: prices in ETB, 15% VAT, Telebirr / CBE / bank apps, screenshots of
transfers, receipt printers on the local network, a cash drawer that must balance at night, and
waiter phones that keep working when the Wi-Fi drops.

---

## Contents

1. [What it does](#what-it-does)
2. [Screens and who uses them](#screens-and-who-uses-them)
3. [Quick start (try it on your computer)](#quick-start-try-it-on-your-computer)
4. [Demo accounts](#demo-accounts)
5. [Using it day to day](#using-it-day-to-day)
6. [How payments work](#how-payments-work)
7. [Printing](#printing)
8. [Going live in a real cafe](#going-live-in-a-real-cafe)
9. [Backups](#backups)
10. [Commands](#commands)
11. [Project layout](#project-layout)
12. [Security](#security)
13. [Known limits](#known-limits)

---

## What it does

**Waiters (phone)**
- Floor plan of tables: free, seated, food ready, waiting for the bill.
- Menu with photos, add-ons (extra shot, no sugar…) and notes.
- Send to the kitchen; items go only to the station that makes them.
- Keeps working offline: orders are queued and sent when the connection comes back.
- "Customer paid by transfer": pick the bank, type the amount they sent, snap a photo of their
  "payment successful" screen. It goes straight to the cashier to check.
- Rings 3 times when food is ready.

**Kitchen, coffee bar, juice bar (tablet or screen)**
- Each station sees only its own tickets, with timers that turn amber and red when late.
- Start / Done buttons, voids shown clearly, recall a ticket bumped by mistake.
- Mark items out of stock (waiters see them greyed out immediately).
- Rings 3 times on every new ticket.

**Cashier (PC or tablet)**
- Open bills sorted by who's waiting, with search.
- Cash with quick-note buttons and change shown big; card; Telebirr, CBE and any bank app.
- Split a bill, pay part now and the rest later, mix cash and transfer.
- Check transfers right on the bill: see the photo, then **✓ Received** or **✗ Not received**.
- Transaction numbers can be typed later; the drawer won't close until they're all in.
- Refunds from the "Closed today" tab (big refunds need a manager's PIN).
- Open and close the cash drawer with a blind count; differences go to a manager.
- **Payments** page: every payment of the day with bank logos, photos and transaction numbers.

**Manager / owner (any device)**
- Today: sales, open tables, late tickets, printers offline, things needing attention.
- Reports by day, item, category, waiter, payment method and hour.
- Menu (photos, prices, stations, remove / bring back), tables, staff and roles, printers.
- Settings: cafe name and logo, VAT and service charge, limits, payment methods and account numbers.
- **Printed bills**: every receipt and ticket shown exactly as it came out of the printer.
- Activity log of every sensitive action, with who did it and when.

---

## Screens and who uses them

| Address | Who | Device |
| --- | --- | --- |
| `/pos/tables` | Waiters | Phone |
| `/pos/cashier` | Cashier | PC or tablet |
| `/pos/payments` | Cashier, manager | PC or tablet |
| `/kds` | Kitchen, coffee bar, juice bar | Tablet or wall screen |
| `/admin` | Manager, owner | Any |

Everyone signs in with their own username. The app opens the right screen for their role.

---

## Quick start (try it on your computer)

You need **Node.js 20 or newer** and **Docker**.

```bash
git clone https://github.com/robi-kas/ca.git cafe-pos
cd cafe-pos
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

`npm run dev` starts the database, applies database updates, and runs the API and the website
together. Press **Ctrl+C** to stop everything.

The first time, add the demo menu, tables and staff:

```bash
npm run db:seed
```

Then open **http://localhost:3000** (cafe code: `default`).

**On a phone:** connect it to the same Wi-Fi as the computer (a phone hotspot works too).
`npm run dev` prints the address to open, like `http://192.168.43.57:3000`.
If it doesn't load, allow the port: `sudo ufw allow 3000/tcp`.

---

## Demo accounts

Created only on a development install. All demo staff use the password **`cafe-demo-1234`**.

| Username | Role | Opens on |
| --- | --- | --- |
| `admin` (password `admin123`) | Owner, can do everything | Manage |
| `meron` | Manager, approval PIN **2468** | Manage |
| `selam` | Supervisor, approval PIN **2468** | Manage (no money reports) |
| `hana`, `dawit` | Waiters | Floor |
| `sara` | Cashier | Cashier |
| `abebe` | Chef | Kitchen screen |
| `liya` | Barista | Coffee screen |
| `yonas` | Juice bar | Juice screen |

---

## Using it day to day

**Opening**
1. Cashier opens the drawer and counts the starting cash (the "float").
2. Kitchen, coffee and juice screens are opened on their tablets and left on.

**An order**
1. Waiter taps a table, adds items, taps **Send to kitchen**.
2. Each station gets its part. When they tap **Done**, the waiter's phone rings.
3. Waiter serves, then taps **Ask for bill** (or takes a transfer at the table).
4. Cashier takes payment. When the bill is fully paid, it closes and the table frees itself.

**Mistakes**
- Removing an item before it's sent: free.
- Removing an item the kitchen already has, big discounts, cancelling an order, big refunds: a
  manager enters their PIN on the same screen. Both names are recorded.

**Closing**
1. Every transfer is checked and every transaction number filled in.
2. Cashier closes the drawer by counting notes and coins without seeing the expected amount.
3. If it doesn't match, a manager signs off the difference. The report is printed or saved.

---

## How payments work

**Cash:** the cashier taps the amount handed over; the change is shown in big numbers. The drawer
expects the bill amount (for example, 200 in and 10 change out means 190 stays in the drawer).

**Telebirr, CBE, other banks:** there are two ways.
- *At the till:* the customer sends to the account number shown on screen; the cashier records it.
- *At the table:* the waiter records it on their phone with a photo of the customer's screen.

Either way it shows as **not checked yet** until the cashier (or a manager) confirms the money
arrived, and only then does it count as paid.

**One number decides everything:** type what the customer actually sent.
- Less than the bill: it's a part payment; the rest is paid at the till.
- Exactly the bill: done.
- More than the bill: the difference is given as cash change from the drawer when the transfer is
  confirmed. If the transfer turns out to be fake, no cash has left yet.

**Safety rules**
- The same transaction number can't be used twice.
- Change can never be more than the bill (no "cash-out" service).
- Owners can require a *second person* to check transfers (Settings, off by default).
- Payment methods, which need a screenshot, and the account numbers printed on bills are set in
  **Manage → Settings → Payment methods**.

---

## Printing

Any network ESC/POS thermal printer (80 mm or 58 mm) on port 9100.

1. **Manage → Kitchen & printers**: add each printer with its IP address and which station it serves.
2. Tap **Test** to print a test page.

Receipt printers print the bill and the receipt with your logo; station printers print tickets
(they beep). **Manage → Printed bills** shows every receipt and ticket exactly as printed,
lets you save it as an image, print it on a normal printer, or print a copy.

If the server is in the cloud rather than in the cafe, run the small print agent inside the cafe;
see [apps/print-agent/README.md](apps/print-agent/README.md).

---

## Going live in a real cafe

Development mode (`npm run dev`) is for trying things. For real service, use **production mode**.
It is faster, starts by itself when the computer boots, uses a **clean database** with no demo
accounts, and backs up every night.

Full step-by-step guide: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**. In short, on the cafe laptop:

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env        # set POSTGRES_PASSWORD and BACKUP_PASSPHRASE to long random values
chmod 600 deploy/.env

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec \
  -e SEED_ADMIN_PASSWORD='your-own-strong-password' api npx prisma db seed

sudo systemctl enable docker
```

Open `http://localhost` (phones: `http://<laptop IP>`), sign in as `admin`, change the password,
then set up the menu, tables, printers, payment accounts and **one login per staff member**.

**Before taking real money**
- Run it next to your current system for 2–3 days (checklist in OPERATIONS.md).
- Put the laptop, router and printers on a UPS.
- Use a password-protected Wi-Fi that customers can't join.
- If your business is VAT-registered: Ethiopian law generally requires receipts from a Ministry of
  Revenue approved sales register machine. Bills from this system say *"not a fiscal receipt"*.
  Ask your accountant.

---

## Backups

Production mode writes an encrypted backup of the database and photos every 24 hours to
`deploy/backups/`, keeping 30 days. **A backup on the same laptop is not a backup**: copy that
folder to a USB disk or cloud storage at least once a week. Keep `BACKUP_PASSPHRASE` in a password
manager; without it the backups can't be opened. Restoring is described in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start everything for development (database, API, website) |
| `npm run db:seed` | Add roles, and on development installs the demo menu, tables and staff |
| `npm run db:migrate` | Apply database updates (`npm run dev` does this automatically) |
| `npm run typecheck` | Check the code for type errors |
| `npm run lint` | Check code style (website) |
| `npm test` | Unit tests (no database needed) |
| `npm run test:integration` | Tests against the development database |
| `npm run build` | Production build of the API and website |

GitHub Actions runs typecheck, lint, tests and a Docker build on every push to `main`.

---

## Project layout

```
apps/
  api/            NestJS + Prisma: every business rule and all money maths
    prisma/       database schema, migrations, seed
    src/          orders, kitchen, payments, refunds, shifts, printers, receipts, reports, admin…
  web/            Next.js: every screen (waiter, kitchen, cashier, manage)
  print-agent/    small script that feeds printers when the API is in the cloud
packages/shared/  shared helpers
deploy/           production Docker setup, HTTPS proxy, backup and restore scripts
docs/             OPERATIONS.md: going live, printing, backups, checklists
scripts/dev.mjs   the `npm run dev` runner
```

How the pieces talk:

```
phones / tablets ──► web (Next.js) ──/api──► api (NestJS) ──► PostgreSQL
                         ▲                     │ live updates
                         └─────────────────────┘
                                               └──► network printers (port 9100)
```

The website only talks to its own address and forwards `/api` to the API, so logins use a
secure cookie that JavaScript can't read.

---

## Security

- Passwords are hashed; 5 wrong tries lock an account for 15 minutes.
- Sessions end after inactivity; changing a password signs out other devices.
- Every write needs a special header, which blocks fake requests from other websites.
- Staff only see their own branch; each role only gets what it needs.
- Money is never a floating-point number; totals are calculated once, on the server.
- Every write to an order locks it first, so two people can't pay the same bill twice, and a
  payment sent twice by a flaky connection is recorded only once.
- Transfer screenshots are private and only served to signed-in staff.
- The activity log records every void, discount, refund, price change and drawer difference.
  Old entries can be cleared only by the owner, only in whole periods, and the clearing is logged.

---

## Known limits

- Receipts are not fiscal receipts (see above).
- Thermal printers can't print Amharic letters in text mode; give menu items a Latin name for
  tickets (they print as "?" otherwise; the Printed bills preview shows exactly what printed).
- On plain `http` (the local network without a domain) phones can't install the app, open it with
  no connection at all, or keep the screen awake. Orders taken during a short Wi-Fi drop are still
  queued and sent. A domain with HTTPS removes these limits (OPERATIONS.md, "Deploy (one server)").
- Designed for one cafe per server; several branches work but the multi-branch screens are basic.
