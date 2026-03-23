# Business Exchange

Business Exchange is a B2B integration platform where partners can register, discover each other, subscribe to data feeds, and exchange business messages across multiple formats such as JSON, XML, CSV, and EDI.

The platform uses an AI-powered mapping engine to normalize partner payloads into a canonical data model (CDM) and reshape them into each receiver's preferred format.

## What this repository contains

This is a Turborepo monorepo with:

- backend microservices under `apps/`
- a Next.js partner/admin portal under `apps/partner-portal`
- shared packages under `packages/`
- local infrastructure and deployment assets under `infra/`

## Table of contents

- [Architecture](#architecture)
- [Core message flow](#core-message-flow)
- [Services and ports](#services-and-ports)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Development workflows](#development-workflows)
- [Agent orchestrator](#agent-orchestrator)
- [AI mapping and visibility model](#ai-mapping-and-visibility-model)
- [Deployment](#deployment)
- [Demo mode](#demo-mode)
- [Operational notes](#operational-notes)
- [Troubleshooting](#troubleshooting)

## Architecture

All external traffic enters through the API gateway. The gateway validates JWTs, applies rate limiting, and reverse-proxies requests to downstream services.

```text
Client / Partner Portal
        |
        v
  API Gateway (:3000 / :11000)
        |
        +--> Auth Service
        +--> Partner Service
        +--> Subscription Service
        +--> Integration Service
        +--> Mapping Engine
        +--> Agent Orchestrator
        +--> Billing Service
```

The platform is designed around a few main ideas:

- partners self-register and maintain their own integration settings
- subscriptions define which partners are allowed to exchange messages
- the integration service handles message routing and webhook delivery
- the mapping engine converts partner-specific payloads through an internal CDM
- the agent orchestrator performs retry, monitoring, drift detection, and alerting tasks

## Core message flow

When a partner sends a message, the high-level path is:

1. The sender calls the gateway.
2. The gateway authenticates the request and forwards it to the integration service.
3. The integration service verifies there is an active subscription between sender and receiver.
4. If schemas exist, the mapping engine attempts a two-stage transformation:
   - sender format -> CDM
   - CDM -> receiver format
5. The integration service stores message state and delivers the resulting payload to the receiver webhook.
6. Retry and monitoring agents handle failed webhook delivery attempts later if needed.

### Public routes

These routes do not require JWT authentication:

- `GET /api/partners/platform-branding`
- `POST /api/partners`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/token`

## Services and ports

| Component | Dev Port | Docker Port | Responsibility |
| --- | --- | --- | --- |
| Gateway | `3000` | `11000` | Single entry point, JWT auth, rate limiting, reverse proxy |
| Auth Service | `3001` | `11001` | Login, refresh tokens, OAuth2, API keys |
| Partner Service | `3002` | `11002` | Partner registration, profiles, KYB approval, branding |
| Subscription Service | `3003` | `11003` | Discovery and subscription lifecycle |
| Integration Service | `3004` | `11004` | Message routing, storage, delivery, status tracking |
| Mapping Engine | `3005` | `11005` | AI schema inference and transformation |
| Agent Orchestrator | `3006` | `11006` | Monitor, retry, schema-change, and alert agents |
| Billing Service | `3007` | `11010` | Usage tracking and billing |
| Partner Portal | `3100` | `11009` | Next.js UI for partners and admins |
| PostgreSQL | `5432` | `11007` | Primary database |

## Repository layout

```text
business-exchange/
├── apps/
│   ├── gateway/
│   ├── auth-service/
│   ├── partner-service/
│   ├── subscription-service/
│   ├── integration-service/
│   ├── mapping-engine/
│   ├── agent-orchestrator/
│   ├── billing-service/
│   └── partner-portal/
├── packages/
│   ├── shared-types/
│   ├── shared-utils/
│   ├── database/
│   └── logger/
├── infra/
├── docker-compose.yml
├── turbo.json
└── package.json
```

### Shared packages

- `@bx/shared-types`: shared TypeScript contracts such as `ApiResponse<T>`, `Partner`, `Message`, and subscription models
- `@bx/shared-utils`: IDs, webhook signing, hashing, backoff, and other shared helpers
- `@bx/database`: PostgreSQL connection and migrations
- `@bx/logger`: Pino logger factory

## Getting started

### Prerequisites

- Node.js 20+
- npm 11+
- Docker Desktop for containerized local development
- an `ENCRYPTION_KEY` so stored LLM credentials can be encrypted and decrypted

### Quick start with Docker Compose

This is the fastest way to bring the full stack up locally.

```bash
git clone https://github.com/sprintly-exchange/business-exchange.git
cd business-exchange

cp .env.example .env
# edit .env with at least JWT_SECRET, WEBHOOK_SECRET, and ENCRYPTION_KEY

docker compose up -d --build
```

Then open:

- Partner Portal: `http://localhost:11009`
- Gateway: `http://localhost:11000`

To stop everything:

```bash
docker compose down
```

### Quick start for workspace development

If you want hot reload directly from the monorepo:

```bash
npm install
cp .env.example .env
npm run dev
```

Useful variants:

```bash
npm run build
npm run typecheck
npm run lint

cd apps/gateway && npm run dev
cd apps/partner-portal && npm run dev
cd packages/database && npm run db:migrate
cd packages/database && npm run db:migrate:down
```

### Health checks

Each backend service follows the same service pattern and exposes a `/health` endpoint. The most important local checks are:

- gateway: `http://localhost:11000/health`
- partner portal: `http://localhost:11009`

## Environment configuration

Start from `.env.example`.

### Required for local development

```bash
JWT_SECRET=change-me
WEBHOOK_SECRET=change-me-too
ENCRYPTION_KEY=<64-char-hex-key>
```

### Platform-default LLM setup

The platform default LLM is configured in the application, not via `.env`.

1. Start the stack.
2. Sign in as admin.
3. Open `Admin Settings`.
4. Configure the platform default LLM provider, endpoint/base URL, model/deployment, and API key.

Partner-specific BYO-LLM overrides are also configured from the portal UI.

### Other useful variables

From `.env.example`:

- `CORS_ORIGIN`
- `LOG_LEVEL`
- `RATE_LIMIT_MAX`
- `MAPPING_ENGINE_URL`
- `ENCRYPTION_KEY`

### Partner BYOLLM

The platform supports **BYOLLM** ("bring your own LLM") at the partner level.

By default, partners use the platform-configured LLM. A partner can switch to their own provider in the portal under **Settings** by saving:

- `llm_use_platform=false`
- `llm_provider`
- `llm_model`
- `llm_endpoint` for `azure` and `openai-compatible`
- `llm_api_key`

Supported partner-level providers match the platform provider set:

- `azure`
- `openai`
- `openai-compatible`

Important behavior:

- partner API keys are stored encrypted and are not returned by the public profile API
- the integration service loads sender and receiver LLM configs per request
- the mapping engine can use different LLM configs for stage 1 and stage 2 of a transform
- if no partner-level config exists, the platform LLM is used automatically

In practice this means:

- sender can use their own LLM for `sender format -> CDM`
- receiver can use their own LLM for `CDM -> receiver format`
- the two sides do not need to use the same provider or model

## Development workflows

### Common commands

| Command | What it does |
| --- | --- |
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Run all services with hot reload through Turbo |
| `npm run build` | Build every workspace |
| `npm run typecheck` | Type-check every workspace |
| `npm run lint` | Run lint across workspaces |
| `npm run clean` | Clean workspace artifacts and root `node_modules` |

### Single-service development

Examples:

```bash
cd apps/gateway && npm run dev
cd apps/integration-service && npm run dev
cd apps/partner-portal && npm run dev
```

### Database migrations

The Docker setup mounts `packages/database/migrations` into Postgres initialization. For manual migration work:

```bash
cd packages/database && npm run db:migrate
cd packages/database && npm run db:migrate:down
```

### Current test posture

The monorepo exposes a root `npm run test`, but there are currently no meaningful automated test suites checked in for most services. Right now, `typecheck` is the main repository-wide validation path.

## Agent orchestrator

The `agent-orchestrator` service is a lightweight Node.js worker service that runs scheduled operational jobs in-process using `node-cron`.

### How it is structured

At startup, the service creates one in-memory instance of each agent class:

- `MonitorAgent`
- `RetryAgent`
- `SchemaChangeAgent`
- `AlertAgent`

These are ordinary class instances inside the long-running `agent-orchestrator` Node.js process. They are not separate containers, and they are not separate OS processes.

`node-cron` keeps the schedules and calls each instance's `.run()` method on the defined interval.

### Current schedules

| Agent | Cron | Interval | What it does |
| --- | --- | --- | --- |
| Monitor Agent | `* * * * *` | Every minute | Marks stuck `processing` messages as `failed` and logs high error-rate conditions |
| Retry Agent | `*/2 * * * *` | Every 2 minutes | Re-attempts failed webhook deliveries with backoff and increments retry count |
| Schema Change Agent | `*/30 * * * *` | Every 30 minutes | Flags active schemas as `drift_suspected` when recent failure rate is high |
| Alert Agent | `*/5 * * * *` | Every 5 minutes | Emits alert events for recent dead-letter and schema-review conditions |

### How the agents make decisions

Current agents are **rule-based**, not LLM-driven.

They make decisions from:

- SQL queries against platform data
- thresholds such as failure-rate percentages
- retry counters
- recent time windows such as "last 5 minutes" or "last 2 hours"

Examples:

- the monitor agent checks for messages stuck in `processing` for more than 5 minutes
- the retry agent retries only failed messages with fewer than 3 retries
- the schema-change agent looks for partners with more than 5 recent messages and failure rate above 30%
- the alert agent looks for newly dead-lettered messages and schemas recently marked `drift_suspected`

### LLM behavior

The current scheduled agents do **not** use an LLM for decision-making.

That means:

- they do not call Azure OpenAI, OpenAI, or partner BYOLLM endpoints
- they do not use partner-specific LLM settings from the portal
- they do not use the platform/global LLM configuration either

LLM selection currently applies to:

- message mapping transforms
- schema generation

For those paths, partner BYOLLM can be used when configured; otherwise the platform LLM is used.

### Runtime tracking and monitoring

The agent orchestrator now tracks runtime state in memory for each scheduled agent, including:

- whether it is currently running
- total run count since service start
- last start time
- last completion time
- last duration
- last success or failure
- last error message

These runtime snapshots are exposed through:

- `GET /api/agents/overview`

Recent persisted agent events are exposed through:

- `GET /api/agents/events`
- `GET /api/agents/events/:entityId`

The partner portal uses these endpoints to power:

- the **Agent Monitor** page
- the main dashboard's technical visibility panels

### Event logging

Agents record operational events into the `agent_events` table.

These events are used for:

- operator visibility
- dashboard summaries
- recent event feeds
- debugging agent actions after the fact

Typical event examples:

- `mark_stuck_failed`
- `retry_delivery`
- `schema_drift_detected`
- `dead_letter_alert`
- `schema_review_alert`

### Configuration and environment

The agent orchestrator itself does not need separate agent-specific cron configuration at the moment; schedules are currently defined directly in source code in `apps/agent-orchestrator/src/index.ts`.

Important runtime configuration still comes from normal platform environment variables such as:

- `WEBHOOK_SECRET` for retry webhook signing
- `DATABASE_URL` for database access
- standard service URL variables when running in Docker or distributed environments

### Operational caveat

Because runtime state is held in memory:

- "currently running" and "total runs since start" reset when the `agent-orchestrator` service restarts
- persisted `agent_events` remain in PostgreSQL and survive restarts

## AI mapping and visibility model

### Canonical Data Model (CDM)

The mapping engine uses an internal CDM as an intermediate representation between sender and receiver formats.

Typical transformation path:

```text
Sender Payload -> CDM -> Receiver Payload
```

### Mapping stages and partner LLM selection

The mapping engine supports two independent LLM stages:

1. sender payload -> CDM
2. CDM -> receiver payload

Each stage can use either:

- the platform LLM, or
- the partner's own BYOLLM configuration

This allows mixed flows such as:

- sender uses platform LLM, receiver uses BYOLLM
- sender uses Azure OpenAI, receiver uses an OpenAI-compatible endpoint
- both partners use platform LLM

Billing and tracing behavior distinguishes platform LLM usage from external partner-managed usage.

### Visibility rules in the integrations UI

The project currently uses viewer-aware payload visibility in the message detail experience:

- sender sees the original raw payload and the CDM
- receiver sees the CDM and the delivered payload in the receiver-facing format
- admin sees all payload variants

This keeps the sender's original raw payload private from receivers while still letting receivers inspect the intermediate normalized representation.

### Mapping fallback behavior

If mapping fails or times out:

- the message can still be delivered successfully
- the UI shows delivery status separately from mapping status
- mapping fallback is surfaced as a warning rather than a delivery failure
- senders can resend the original payload from the message detail UI

## Deployment

### Local Docker Compose

```bash
docker compose up -d
docker compose up -d --build
docker compose logs -f gateway
docker compose logs -f partner-portal
docker compose down
```

### Fly.io

Two deployment topologies are supported. Choose one and use the matching env file and scripts.

#### Single-host (one Fly app)

All services run inside a single Fly app behind nginx. Best for low-traffic environments, demos, or cost-sensitive deployments.

```bash
# 1. Create your env file from the example
cp infra/.env.fly.single.example infra/.env.fly.single
# edit infra/.env.fly.single — fill in FLY_API_TOKEN, APP_NAME, and secrets

# 2. Provision the app and Postgres (run once)
bash infra/fly/single/setup-single.sh

# 3. Deploy
bash infra/fly/single/deploy-single.sh
```

Key variables for single-host:

| Variable | Description |
| --- | --- |
| `APP_NAME` | Globally unique Fly.io app name (e.g. `bx-mycompany`) |
| `FLY_API_TOKEN` | `flyctl auth token` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `PG_NAME` | Postgres cluster name, defaults to `${APP_NAME}-db` |
| `DATABASE_URL` | Auto-provisioned by `setup-single.sh` — leave blank on first run |

After deploy the platform is at `https://<APP_NAME>.fly.dev`.

#### Multi-app (one Fly app per service)

Each service deploys as its own Fly app (`bx-gateway`, `bx-auth-service`, etc.). Best for production where independent scaling and rolling deploys matter.

```bash
# 1. Create your env file from the example
cp infra/.env.fly.multi.example infra/.env.fly.multi
# edit infra/.env.fly.multi — fill in FLY_API_TOKEN and secrets

# 2. Provision all apps and Postgres (run once)
bash infra/fly/multi/setup.sh

# 3. Deploy all services
bash infra/fly/multi/deploy.sh

# Redeploy a single service
bash infra/fly/multi/deploy.sh --app bx-gateway
```

Key variables for multi-app:

| Variable | Description |
| --- | --- |
| `FLY_API_TOKEN` | `flyctl auth token` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `GATEWAY_URL` | Public gateway URL used as `NEXT_PUBLIC_API_URL` at portal build time |
| `DATABASE_URL` | Auto-provisioned by `setup.sh` — leave blank on first run |

After deploy:
- Portal: `https://bx-partner-portal.fly.dev`
- Gateway: `https://bx-gateway.fly.dev`

#### Env file reference

| File | Mode | Committed |
| --- | --- | --- |
| `infra/.env.fly.single.example` | Single-host template | ✅ yes |
| `infra/.env.fly.single` | Single-host secrets | ❌ git-ignored |
| `infra/.env.fly.multi.example` | Multi-app template | ✅ yes |
| `infra/.env.fly.multi` | Multi-app secrets | ❌ git-ignored |

### Azure Container Apps

Infrastructure templates for Azure live under `infra/bicep/`.

The partner portal needs the gateway URL as a build-time input when deployed externally.

## Demo mode

Demo mode seeds a realistic working environment for demos and manual testing.

The default scenario now models a pharmaceutical distribution lane:

- CareBridge Pharmacy Network places replenishment orders
- MediCore Systems manufactures and invoices OTC pharmacy products
- GlobalTrade Logistics handles transport and shipment visibility
- NexusPay Finance advances and settles MediCore receivables

### What it gives you

- preconfigured partner companies
- seeded subscriptions
- seeded end-to-end messages across JSON, XML, CSV, X12, and EDIFACT
- predictable login credentials for demos

### Demo accounts

All demo partners use password `Demo@1234`.

| Company | Email | Focus |
| --- | --- | --- |
| CareBridge Pharmacy Network | `edi@carebridge-demo.io` | Pharmacy retail and replenishment |
| MediCore Systems | `integration@medicore-demo.io` | Pharmaceutical manufacturing |
| GlobalTrade Logistics | `ops@globaltrade-demo.io` | Transport and cold-chain logistics |
| NexusPay Finance | `treasury@nexuspay-demo.io` | Receivables finance and settlement |

### Suggested end-to-end demo flow

1. Sign in as CareBridge and review the seeded X12 850 purchase order to MediCore.
2. Switch to MediCore to show the inbound order, the outbound XML invoice, and the EDIFACT IFTMIN shipment instruction.
3. Switch to GlobalTrade to show the inbound logistics booking and the outbound DESADV shipment notice.
4. Return to CareBridge to show the linked shipment visibility and invoice reconciliation.
5. Finish in MediCore and NexusPay to show the financing request and settlement/remittance trail.

See `DEMO_GUIDE.md` for a full walkthrough, talking points, and sample use cases.

### Admin account

An admin user is created automatically on first startup.

| Field | Default |
| --- | --- |
| Username | `admin` |
| Password | `changeme` |

Change the default password before using the platform anywhere beyond local development.

## Operational notes

### Autonomous agents

The agent orchestrator runs four scheduled agents:

| Agent | Responsibility |
| --- | --- |
| Monitor | Detects stuck messages and elevated error rates |
| Retry | Re-attempts failed webhook deliveries |
| Schema Change | Detects payload drift relative to registered schemas |
| Alert | Surfaces dead-letter and schema-drift issues |

### API response shape

Services return shared response types from `@bx/shared-types`.

Standard response shape:

```ts
{ success: boolean; data?: T; error?: string; message?: string }
```

Paginated endpoints extend this with metadata such as `total`, `page`, and `pageSize`.

### Package import convention

Cross-package imports should always use workspace aliases:

```ts
import { createLogger } from '@bx/logger';
import { generateId } from '@bx/shared-utils';
import type { ApiResponse } from '@bx/shared-types';
```

## Troubleshooting

### The portal loads but API calls fail

Check:

- gateway is running on `11000`
- `NEXT_PUBLIC_API_URL` points to the gateway
- your auth token is present and valid

### Docker services start but mapping does not work

Check:

- a platform default LLM is configured in `Admin Settings`
- `ENCRYPTION_KEY` is set so stored LLM credentials can be decrypted
- `MAPPING_ENGINE_URL` resolves correctly for the environment you are using

### Messages are delivered but mapping shows fallback

That usually means:

- the mapping engine timed out
- no applicable schema was available
- the platform default LLM is missing or misconfigured in `Admin Settings`

Delivery status and mapping status are intentionally tracked separately.

### Lint behaves differently than expected

The repository has a root lint command, but parts of the frontend ecosystem may still trigger first-run tooling setup depending on your local environment. If lint prompts for interactive configuration, finish that setup once and rerun the command.

## Suggested first exploration path

If you are new to the codebase, this order works well:

1. read this README
2. start the stack with Docker Compose
3. sign in to the partner portal
4. explore `apps/gateway`, `apps/integration-service`, and `apps/mapping-engine`
5. inspect shared contracts in `packages/shared-types`
6. review seeded/demo flows in the partner portal

## License / usage

This project is proprietary. All rights reserved by the repository owner. No license is granted for use, distribution, or modification without explicit written permission.
