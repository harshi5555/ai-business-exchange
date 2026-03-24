# Business Exchange

Business Exchange is a B2B integration platform where partners can register, discover each other, subscribe to data feeds, and exchange business messages across multiple formats such as JSON, XML, CSV, and EDI.

The platform uses an AI-powered mapping engine to normalize partner payloads into a canonical data model (CDM) and reshape them into each receiver's preferred format.

Partners can connect to the platform in two ways:

- **Human portal path** — partners self-register through the web UI, configure schemas and webhooks, and manage integrations manually
- **Agent-to-agent path** — a partner's own AI agent (connected to their internal ERP, CRM, or WMS) can autonomously discover, negotiate, and establish a full integration with the platform using the [A2A protocol](https://google.github.io/A2A) and [Model Context Protocol (MCP)](https://modelcontextprotocol.io). No human interaction is required on either side.

## What this repository contains

This is a Turborepo monorepo with:

- backend microservices under `apps/`
- a Next.js partner/admin portal under `apps/partner-portal`
- shared packages under `packages/`
- local infrastructure and deployment assets under `infra/`

## Table of contents

- [Architecture](#architecture)
- [Core message flow](#core-message-flow)
- [Partner integration paths](#partner-integration-paths)
- [Services and ports](#services-and-ports)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Development workflows](#development-workflows)
- [Agent orchestrator](#agent-orchestrator)
- [Agent-to-agent integration](#agent-to-agent-integration)
- [AI mapping and visibility model](#ai-mapping-and-visibility-model)
- [Deployment](#deployment)
- [Demo mode](#demo-mode)
- [Operational notes](#operational-notes)
- [Testing the A2A / MCP integration](#testing-the-a2a--mcp-integration)
- [Troubleshooting](#troubleshooting)

## Architecture

All external traffic enters through the API gateway. The gateway validates JWTs, applies rate limiting, and reverse-proxies requests to downstream services.

```mermaid
graph TB
    subgraph Clients["Clients"]
        PP["🖥️ Partner Portal<br/>:3100"]
        PA["🤖 Partner AI Agent<br/>(external)"]
    end

    subgraph Gateway["API Gateway  :3000"]
        GW["Gateway<br/>JWT auth · rate limiting · reverse proxy"]
    end

    subgraph CoreServices["Core Services"]
        AUTH["Auth Service<br/>:3001"]
        PS["Partner Service<br/>:3002"]
        SS["Subscription Service<br/>:3003"]
        IS["Integration Service<br/>:3004"]
        ME["Mapping Engine<br/>:3005"]
        AO["Agent Orchestrator<br/>:3006"]
        BS["Billing Service<br/>:3007"]
        EA["Exchange Agent<br/>:3008"]
    end

    subgraph Data["Data"]
        PG[("PostgreSQL<br/>:5432")]
        LLM["☁️ LLM Provider<br/>Azure / OpenAI / Compatible"]
    end

    PP -->|JWT / HTTPS| GW
    PA -->|A2A · MCP · x-api-key| GW

    GW --> AUTH
    GW --> PS
    GW --> SS
    GW --> IS
    GW --> ME
    GW --> AO
    GW --> BS
    GW -->|"/.well-known  /a2a  /mcp"| EA

    EA -->|register partner| PS
    EA -->|infer schema| ME
    EA -->|subscribe| SS
    EA -->|configure webhook| IS

    AUTH & PS & SS & IS & ME & AO & BS & EA --> PG
    ME -->|schema inference| LLM
    EA -->|negotiation| LLM
```

The platform is designed around a few main ideas:

- partners self-register and maintain their own integration settings
- subscriptions define which partners are allowed to exchange messages
- the integration service handles message routing and webhook delivery
- the mapping engine converts partner-specific payloads through an internal CDM
- the agent orchestrator performs retry, monitoring, drift detection, and alerting tasks
- the exchange agent enables partner AI agents to autonomously negotiate and establish integrations over A2A and MCP without human involvement

## Core message flow

When a partner sends a message, the high-level path is:

```mermaid
sequenceDiagram
    participant S as Sender Partner
    participant GW as API Gateway
    participant IS as Integration Service
    participant ME as Mapping Engine
    participant R as Receiver Webhook
    participant AO as Agent Orchestrator

    S->>GW: POST /api/integrations/send<br/>(JWT + payload)
    GW->>GW: Validate JWT, inject x-partner-id
    GW->>IS: Forward request
    IS->>IS: Verify active subscription<br/>sender ↔ receiver
    IS->>ME: Transform payload<br/>sender format → CDM → receiver format
    ME-->>IS: Mapped payload (or fallback)
    IS->>IS: Store message (status: processing)
    IS->>R: POST to receiver webhook
    alt Delivery success
        R-->>IS: 2xx
        IS->>IS: status → delivered
    else Delivery fails
        R-->>IS: error / timeout
        IS->>IS: status → failed
        AO->>IS: Retry Agent picks up (every 2 min)
        AO->>R: Re-attempt with backoff
    end
```

### Public routes

These routes do not require JWT authentication:

- `GET /api/partners/platform-branding`
- `POST /api/partners`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/token`
- `GET /.well-known/agent.json` — Exchange Agent discovery card (A2A, no auth required)

A2A task execution (`POST /a2a/tasks`, `/mcp`) requires an API key passed as `x-api-key`.

## Partner integration paths

Partners can connect to the platform through two independent paths. Both are fully supported and can coexist.

### Human portal path

```mermaid
flowchart LR
    A["Partner\nregisters\nin portal"] --> B["Admin\nreviews &\napproves"]
    B --> C["Partner configures\nschemas & webhook\nin Settings"]
    C --> D["Partner sends &\nreceives messages\nvia gateway API"]
```

1. Partner navigates to the portal and self-registers (`POST /api/partners`).
2. Admin reviews and approves the application.
3. Partner configures schemas, mapping rules, and webhook delivery settings through the UI.
4. Partner sends and receives messages via the gateway API.

### Agent-to-agent path

```mermaid
sequenceDiagram
    participant PA as Partner AI Agent
    participant GW as Gateway
    participant EA as Exchange Agent
    participant ME as Mapping Engine
    participant PS as Partner Service

    PA->>GW: GET /.well-known/agent.json
    GW-->>PA: Agent Card (skills, auth, endpoint)

    PA->>GW: POST /a2a/tasks<br/>x-api-key · "We produce orders in JSON..."
    GW->>EA: Forward
    EA->>EA: Create session (state: discovery)
    EA-->>PA: Task accepted · state: working<br/>"Please send a sample payload"

    PA->>GW: POST /a2a/tasks/:id/send<br/>{ sample payload }
    GW->>EA: Forward
    EA->>ME: Infer schema + mapping rules
    ME-->>EA: Mapping rules (confidence scores)
    EA-->>PA: state: input-required<br/>"Proposed mapping. Confirm + provide webhook URL"

    PA->>GW: POST /a2a/tasks/:id/send<br/>{ accept: true, webhookUrl }
    GW->>EA: Forward
    EA->>PS: Register partner
    PS-->>EA: partnerId + credentials
    EA-->>PA: state: completed<br/>{ partnerId, apiKey, subscription }
```

A partner's AI agent (running in their own infrastructure, connected to their ERP, CRM, or WMS) can autonomously complete the same onboarding steps through machine-to-machine protocols:

1. Partner agent discovers the Exchange Agent via `GET /.well-known/agent.json`.
2. Partner agent sends a task to `POST /a2a/tasks` describing integration intent.
3. Exchange Agent (backed by an LLM-driven negotiation engine) requests a sample payload.
4. Exchange Agent runs AI schema inference, proposes mapping rules and available subscriptions.
5. Partner agent accepts or counter-proposes terms.
6. Exchange Agent provisions the partner account, configures the webhook, and issues credentials.
7. Integration goes live with no human steps on either side.

The agent path calls the same internal service APIs as the human portal. No existing behavior is changed.

## Services and ports

| Component | Port | Responsibility |
| --- | --- | --- |
| Gateway | `3000` | Single entry point, JWT auth, rate limiting, reverse proxy |
| Auth Service | `3001` | Login, refresh tokens, OAuth2, API keys |
| Partner Service | `3002` | Partner registration, profiles, KYB approval, branding |
| Subscription Service | `3003` | Discovery and subscription lifecycle |
| Integration Service | `3004` | Message routing, storage, delivery, status tracking |
| Mapping Engine | `3005` | AI schema inference and transformation |
| Agent Orchestrator | `3006` | Monitor, retry, schema-change, and alert agents |
| Billing Service | `3007` | Usage tracking and billing |
| Exchange Agent | `3008` | A2A + MCP server; partner agent negotiation and autonomous onboarding |
| Partner Portal | `3100` | Next.js UI for partners and admins |
| PostgreSQL | `5432` | Primary database |

## Repository layout

```mermaid
graph LR
    subgraph apps["apps/  — deployable services"]
        GW2["gateway<br/>:3000"]
        AU["auth-service<br/>:3001"]
        PA2["partner-service<br/>:3002"]
        SU["subscription-service<br/>:3003"]
        IN["integration-service<br/>:3004"]
        MA["mapping-engine<br/>:3005"]
        AG["agent-orchestrator<br/>:3006"]
        EX["exchange-agent<br/>:3008  ★ A2A/MCP"]
        BI["billing-service<br/>:3007"]
        PO["partner-portal<br/>:3100  Next.js"]
    end

    subgraph packages["packages/  — shared libraries"]
        ST["@bx/shared-types"]
        SU2["@bx/shared-utils"]
        DB["@bx/database"]
        SDK["@bx/a2a-sdk  ★ new"]
        LG["@bx/logger"]
    end

    GW2 & AU & PA2 & SU & IN & MA & AG & EX & BI --> ST
    GW2 & AU & PA2 & SU & IN & MA & AG & EX & BI --> LG
    PA2 & SU & IN & MA & AG & EX & BI & AU --> DB
    EX --> SDK
```

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
│   ├── exchange-agent/            ← A2A + MCP server for partner agent onboarding
│   ├── billing-service/
│   └── partner-portal/
├── packages/
│   ├── shared-types/
│   ├── shared-utils/
│   ├── database/
│   ├── a2a-sdk/                   ← A2A and MCP protocol types (shared)
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
- `@bx/a2a-sdk`: A2A and MCP protocol types — `AgentCard`, `Task`, `TaskState`, `MCPTool`, `MCPToolResult`
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

- Partner Portal: `http://localhost:3100`
- Gateway: `http://localhost:3000`

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

- gateway: `http://localhost:3000/health`
- partner portal: `http://localhost:3100`

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

## Agent-to-agent integration

The `exchange-agent` service gives the platform its own AI agent identity. Partner-owned agents (connected to internal ERP, CRM, WMS, or any system) can use standard agent protocols to discover, negotiate with, and integrate into the platform entirely autonomously.

### Protocols supported

| Protocol | Transport | Purpose |
| --- | --- | --- |
| A2A (Google Agent-to-Agent) | HTTPS + SSE | Multi-turn task negotiation between agents |
| MCP (Model Context Protocol) | Streamable HTTP | LLM tool calls against platform capabilities |

### Endpoints

| Route | Auth | Description |
| --- | --- | --- |
| `GET /.well-known/agent.json` | None | Agent Card — partner agents discover this to learn skills, auth requirements, and endpoints |
| `POST /a2a/tasks` | API key | Submit a new negotiation task (e.g. "I want to integrate") |
| `GET /a2a/tasks/:id` | API key | Poll task status and read the agent's latest response |
| `POST /a2a/tasks/:id/send` | API key | Continue a multi-turn negotiation (send sample payload, accept proposal, etc.) |
| `POST /mcp` | API key | MCP tool call endpoint (Streamable HTTP, 2025-03-26 spec) |

### MCP tools available to partner agents

| Tool | What it does |
| --- | --- |
| `get_platform_info` | Returns platform capabilities and supported formats |
| `register_partner` | Creates a partner account |
| `discover_subscriptions` | Lists available data feeds |
| `submit_schema_sample` | Sends a sample payload and receives an AI-generated mapping proposal |
| `confirm_mapping` | Accepts or rejects a proposed mapping rule set |
| `request_subscription` | Subscribes to a data feed |
| `configure_webhook` | Sets the delivery endpoint for inbound messages |
| `get_onboarding_status` | Returns current onboarding state and any pending steps |
| `get_integration_health` | Returns message delivery statistics |

### Negotiation state machine

Each A2A session progresses through the following states:

```mermaid
stateDiagram-v2
    [*] --> discovery : Partner agent sends first task

    discovery --> schema_submitted : Partner sends sample payload
    schema_submitted --> mapping_proposed : AI infers schema & rules

    mapping_proposed --> terms_negotiated : Partner accepts mapping
    mapping_proposed --> counter_offered : Partner rejects / proposes changes
    counter_offered --> mapping_proposed : Exchange Agent revises proposal

    terms_negotiated --> provisioning : Partner provides webhook URL
    provisioning --> active : Partner account provisioned ✅

    mapping_proposed --> abandoned : No response (timeout)
    terms_negotiated --> abandoned : No response (timeout)
    provisioning --> failed : Registration or webhook error

    active --> [*]
    failed --> [*]
    abandoned --> [*]
```

Session state is stored in the `agent_sessions` table. Sessions that stall are escalated to the admin review queue in the portal under **A2A Sessions**.

### LLM usage

The negotiation engine uses the platform-configured LLM (same provider and credentials set in `Admin Settings`). No separate LLM configuration is needed for the exchange agent.

### Authentication for partner agents

- **Agent Card discovery** (`/.well-known/agent.json`) is public — no credentials required
- **Task and MCP endpoints** require an API key in the `x-api-key` request header
- API keys can be pre-issued to trusted partner agents or generated during the negotiation itself

### How it relates to the existing architecture

The exchange agent is a purely additive service. It calls the same internal APIs as the partner portal:

| Exchange agent action | Internal call |
| --- | --- |
| Register partner | `POST partner-service/api/partners` |
| Infer schema | `POST mapping-engine/api/mappings/schemas/register` |
| List subscriptions | `GET subscription-service/api/subscriptions` |
| Subscribe | `POST subscription-service/api/subscriptions` |
| Configure webhook | `PUT integration-service/api/integrations/...` |

No existing services, database schemas, or APIs are modified.

### Viewing A2A sessions in the portal

Admins and partners can view negotiation sessions under **A2A Sessions** in the partner portal. The page shows:

- current negotiation state
- the full conversation transcript between the partner agent and the Exchange Agent
- proposed mapping rules and subscriptions
- a button to manually approve or reject stalled sessions

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

The exchange agent runs as a separate service and handles on-demand agent-to-agent negotiation sessions independently of the cron-based agents above.

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

## Testing the A2A / MCP integration

### Port reference

Ports differ between dev and Docker Compose modes. Set these variables once before running any of the commands below.

**Dev mode (`npm run dev` + `docker compose up -d postgres`) or Docker Compose (`docker compose up -d --build`)**

```bash
export GW="http://localhost:3000"
export PORTAL="http://localhost:3100"
```

### Prerequisites

1. **Start the stack**

   *Dev mode* — Postgres must run in Docker; all other services run via Turbo:
   ```bash
   docker compose up -d postgres
   npm install                        # pick up new packages (a2a-sdk, exchange-agent)
   npm run build -w packages/a2a-sdk  # build shared protocol types first
   npm run dev                        # starts all services including exchange-agent
   ```

   *Docker Compose* — builds and starts everything:
   ```bash
   docker compose up -d --build
   ```

2. **Apply the agent_sessions migration** (only needed once, if your database already existed before this migration was added)

   *Dev mode:*
   ```bash
   DATABASE_URL=postgresql://bx_user:bx_password@localhost:5432/business_exchange \
     npm run db:migrate -w packages/database
   ```

   *Docker Compose:*
   ```bash
   docker exec -i bx-postgres psql -U bx_user -d business_exchange \
     < packages/database/migrations/007_agent_sessions.sql
   ```

   Verify:
   ```bash
   docker exec bx-postgres psql -U bx_user -d business_exchange -c "\dt agent_sessions"
   ```

3. **Verify exchange-agent is healthy**

   ```bash
   curl $GW/health
   # gateway → {"status":"ok","service":"gateway"}

   curl http://localhost:3008/health
   # exchange-agent direct → {"status":"ok","service":"exchange-agent"}
   ```

4. **Configure a platform LLM** in the portal under **Admin Settings**. Without it the negotiation engine falls back to a static prompt.

### Step 1 — Discover the Agent Card (no auth)

```bash
curl $GW/.well-known/agent.json | jq .
```

Expected: Agent Card JSON listing three skills — `partner_onboarding`, `schema_mapping`, and `subscription_discovery`.

### Step 2 — Obtain an API key

1. Open `$PORTAL` in your browser and sign in as any demo partner (e.g. `edi@carebridge-demo.io` / `Demo@1234`)
2. Go to **Settings** in the sidebar and scroll to the **API Keys** section at the bottom
3. Click **Generate New API Key**
4. Copy the key — it starts with `bx_` and is shown only once

```bash
export API_KEY="bx_<paste your key here>"
```

> If you lose a key, revoke it from the same Settings page and generate a new one.

### Step 3 — Start an A2A negotiation task

```bash
curl -X POST $GW/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "skill": "partner_onboarding",
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Hi, we are Acme Corp. We produce purchase orders in JSON from our ERP and want to receive invoice confirmations. Can you onboard us?" }]
    }
  }' | jq .
```

Note the `id` (task ID) in the response.

### Step 4 — Continue the negotiation

```bash
export TASK_ID="<id from step 3>"

# Send a sample payload
curl -X POST $GW/a2a/tasks/$TASK_ID/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Here is our sample: {\"poNumber\":\"PO-1001\",\"vendor\":\"MediCore\",\"items\":[{\"sku\":\"IBUP-200\",\"qty\":500,\"price\":2.50}],\"deliveryDate\":\"2026-04-01\"}" }]
    }
  }' | jq .

# Poll status at any time
curl $GW/a2a/tasks/$TASK_ID \
  -H "x-api-key: $API_KEY" | jq .result.status
```

The session progresses through states: `discovery → schema_submitted → mapping_proposed → terms_negotiated → provisioning → active`.

### Step 5 — Test MCP tools directly

```bash
# Initialize — no auth required
curl -X POST $GW/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | jq .

# List available tools
curl -X POST $GW/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq '.result.tools[].name'

# Call a tool directly
curl -X POST $GW/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": { "name": "get_platform_info", "arguments": {} }
  }' | jq .
```

### Step 6 — View sessions in the portal

Open `$PORTAL` in your browser, sign in, and click **A2A Sessions** in the sidebar. Every negotiation session is listed with its current state, partner details, and the full conversation transcript between the partner agent and the Exchange Agent.

### Expected responses for key checks

| Request | Expected |
| --- | --- |
| `GET /.well-known/agent.json` | Agent Card JSON, 3 skills, no auth required |
| `POST /a2a/tasks` without `x-api-key` | `401 API key required` |
| `POST /a2a/tasks` with valid key | `202` + task with `status.state: "working"` |
| `GET /a2a/tasks/:id` | Current state + negotiation history array |
| `POST /mcp` `initialize` | `200` + protocol version, no auth required |
| `POST /mcp` `tools/list` without key | `401 API key required` |
| Portal A2A Sessions page | Sessions listed with transcript and state badges |

## Troubleshooting

### A2A negotiation session is stuck

If a partner agent session does not progress:

- check that the platform LLM is configured in `Admin Settings` (the negotiation engine uses it)
- check exchange-agent logs: `docker compose logs -f exchange-agent` (Docker) or the Turbo dev output (dev mode)
- review the session transcript in the portal under **A2A Sessions**
- use the admin manual-approve action to unblock the session if the mapping and subscription proposals look correct

### The portal loads but API calls fail

Check:

- gateway is running (`http://localhost:3000`)
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
5. inspect shared contracts in `packages/shared-types` and `packages/a2a-sdk`
6. review seeded/demo flows in the partner portal
7. explore `apps/exchange-agent` for A2A/MCP agent integration

## License / usage

This project is proprietary. All rights reserved by the repository owner. No license is granted for use, distribution, or modification without explicit written permission.
