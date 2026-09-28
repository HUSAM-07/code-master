# Foundry

Foundry turns a product brief and channel messages into GitHub issues and draft pull requests. It runs on Cloudflare Workers with D1, Queues, and a 15 minute Cron Trigger. The dashboard uses Next.js through vinext and free BoardUI components.

Live app: https://foundry-builder.morrow-invitations.workers.dev/

## What works

- Sign in using a fine-grained GitHub PAT. It needs repository Contents, Issues, and Pull requests write access. The PAT is encrypted at rest with AES-GCM.
- Create a project for a repository with an initial commit, choose OpenAI or Anthropic, and enter its key. Foundry encrypts the key in the project vault and queues the first run immediately. Keys can be replaced in Secrets (`AI_PROVIDER`, `AI_API_KEY`; optional `AI_MODEL`).
- Add context manually or connect Slack, Telegram, or WhatsApp. Slack and Telegram are polled; WhatsApp sends signed webhooks.
- Start a run manually. Foundry plans one focused task, creates a GitHub issue, writes complete file changes on a `foundry/` branch, and opens a draft PR. It never merges.
- Free accounts get one project, three manual runs per month, and one scheduled sweep per day. Sweeps keep proposing work from the brief and repository even when no new channel message arrives. Pro accounts get faster scheduled runs and unlimited projects. Stripe Checkout and Customer Portal are ready when billing secrets and a recurring Price are configured.

Cloudflare Queues fills the job-stream role. Kafka is not needed for this workload.

## Local development

```sh
npm install
printf 'APP_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" > .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev
npm run test:smoke
npm run check
```

Keep `.dev.vars` private. The smoke check talks only to the local dev server, creates temporary test records, and removes them afterward.

## Deploy

The Wrangler config names a production D1 database and Queue. In a new account, create resources with `wrangler d1 create` and `wrangler queues create`, then replace the D1 ID in `wrangler.jsonc`.

```sh
npm run db:migrate:remote
npm run deploy
npx wrangler secret put APP_ENCRYPTION_KEY --name foundry-builder
```

Set `APP_ENCRYPTION_KEY` to a persistent base64 32 byte key. Losing it makes stored PATs and project secrets unreadable. Do not rotate it without re-encrypting those records.

## Billing

Create a recurring Stripe Price and a webhook endpoint at `/api/billing/webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Set these Worker secrets using `wrangler secret put`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

The UI exposes Upgrade to Pro. The billing portal API is at `/api/billing/portal`; configure Stripe's Customer Portal before using it.

## Channel setup

Save channel credentials in the project's Secrets tab:

| Channel  | Required project secret(s)                     | Connection reference                                              |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Slack    | `SLACK_BOT_TOKEN`                              | Slack channel ID; grant history scope and invite bot              |
| Telegram | `TELEGRAM_BOT_TOKEN`                           | Telegram chat ID; disable group privacy to see all messages       |
| WhatsApp | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta phone number ID; register the callback URL shown in Channels |

Messages become private context for that project. The application never posts back into those channels.
