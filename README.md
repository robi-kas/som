# New Chapter POS

Point of sale, kitchen display and back office for a cafe — built to run a full day of real
service in Ethiopia: ETB, 15% VAT, Telebirr / CBE Birr, Amharic on the floor screens, printers
on the local network, and a cash drawer that has to balance.

| Screen | Who | Device |
| --- | --- | --- |
| `/pos/tables` → `/pos/orders/:id` | Waiters | Phone (installable web app) |
| `/pos/cashier` | Cashier | Tablet / PC |
| `/kds` | Kitchen & bar | Wall tablet or monitor |
| `/admin` | Manager / owner | Any |

## How it fits together

```
phones / tablets ──HTTPS──► web (Next.js) ──/api proxy──► api (NestJS) ──► PostgreSQL
                                   ▲                         │  live updates (SSE)
                                   └─────────────────────────┘
                                         print jobs ◄── print agent (in the cafe) ──► ESC/POS printers :9100
```

- **apps/api** — NestJS + Prisma. All business rules and money maths live here (`src/common/money/pricing.ts`).
- **apps/web** — Next.js. Talks to the API only through its own origin, so the session is an httpOnly cookie.
- **apps/print-agent** — zero-dependency Node script that runs inside the cafe and feeds the printers.
- **packages/shared** — early financial helpers (not used by the API; kept for future client-side use).
- **apps/pos** — the original Expo placeholder, no longer part of the build (the web app is installable on phones).

Key rules the code enforces:

- Money is never a float. Totals are computed once, on the server, rounded to the santim.
- One open order per table (database constraint); every write to an order locks its row first.
- Removing an item the kitchen already has, discounts above the branch limit, big refunds and drawer
  differences need a manager — in person or by PIN on the same device. The audit log records both people.
- A digital payment (Telebirr / CBE Birr / transfer) counts as paid only after someone *other* than
  the cashier who took it checks the statement. The same reference can't be used twice.
- Orders close themselves when everything is served and paid; the table frees itself.

## Run it locally

Prerequisites: Node 20+, Docker.

```bash
npm install                       # installs all workspaces
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev:db                    # first time only: start Postgres (localhost:5433)
npm run db:migrate                # apply migrations (again after pulling new code)
npm run db:seed                   # roles, demo menu, tables, demo staff
npm run dev                       # database + API (:3001) + web (http://localhost:3000); Ctrl+C stops all
```

Sign in at http://localhost:3000 with cafe code `default`:

| Username | Password | Role | Opens on |
| --- | --- | --- | --- |
| `admin` | `admin123` | Owner (everything) | Manage |
| `meron` | `cafe-demo-1234` | Manager — approval PIN **2468** | Manage |
| `selam` | `cafe-demo-1234` | Supervisor — approval PIN **2468** | Manage (no money reports) |
| `hana`, `dawit` | `cafe-demo-1234` | Waiters | Floor |
| `sara` | `cafe-demo-1234` | Cashier | Cashier |
| `liya` | `cafe-demo-1234` | Barista | Coffee station screen |
| `yonas` | `cafe-demo-1234` | Juice bar | Juice station screen |
| `abebe` | `cafe-demo-1234` | Chef | Kitchen station screen |

Stations: **Coffee** (buna, macchiato, shai, spris…), **Juice** (juices, soft drinks) and **Kitchen** (food).
Each item goes only to its own station's screen and printer. Set which station an item is made at in
*Manage → Menu*, and which station a person works at in *Manage → Staff → Stations*.

Demo accounts are created only outside production. Change the admin password immediately on any real install.

Printing locally: add a printer under *Manage → Kitchen & printers* with its IP. With
`PRINT_MODE=direct` (the default in `.env.example`) the API prints straight to it.

## Checks

```bash
npm run typecheck
npm run lint
npm test                          # unit tests (no database)
npm run test:integration          # needs the dev database running
```

CI runs all of these plus a Docker build on every push (`.github/workflows/ci.yml`).

## Deploy

See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — one server, Docker Compose, automatic HTTPS,
encrypted nightly backups, and the pilot checklist.

## Before you take real money

VAT-registered businesses in Ethiopia generally must issue receipts from a sales register machine
approved by the Ministry of Revenue. Until that's integrated, every bill this system prints says
*"Order bill — not a fiscal receipt"*. Check the rules for your business with an accountant.
