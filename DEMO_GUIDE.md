# Pharmaceutical Demo Guide

This demo is designed around a single, believable B2B healthcare supply-chain story.

## Demo companies

- `CareBridge Pharmacy Network` is the downstream customer. It operates pharmacy outlets and sends replenishment orders for OTC products.
- `MediCore Systems` is the pharmaceutical manufacturer and primary supplier.
- `GlobalTrade Logistics` is the transport and cold-chain logistics provider.
- `NexusPay Finance` is the receivables finance partner for MediCore.

## Core use cases

### 0. Agent-to-agent partner onboarding (A2A / MCP)

A new partner — say, a regional pharmacy wholesaler — wants to connect to the exchange. Instead of a human filling in the portal, their internal AI agent (connected to their order management system) autonomously negotiates and completes the integration.

What happens:

1. The partner agent fetches `GET /.well-known/agent.json` to discover the Exchange Agent and its capabilities.
2. The partner agent sends a task: _"We produce purchase orders in JSON and want to receive invoice confirmations. Here is a sample payload."_
3. The Exchange Agent infers the schema, generates mapping rules with confidence scores, and proposes relevant subscriptions.
4. The partner agent accepts the proposal and supplies a webhook URL.
5. The Exchange Agent provisions the account, activates the subscription, and issues API credentials.
6. The integration is live — no human action required on either side.

Why it demos well:

- shows the platform working as an AI-native integration hub, not just a data pipe
- contrasts with the traditional portal path to highlight automation value
- demonstrates schema inference and subscription matching in a live negotiation loop
- realistic for enterprises that already run their own AI agents against internal systems

### 1. Pharmacy replenishment

CareBridge sends a standard `X12 850 Purchase Order` to MediCore for high-volume pharmacy products like ibuprofen, cold-and-flu relief, and vitamin D.

Why it demos well:

- shows a recognizable B2B order message
- highlights schema mapping from structured EDI into the platform CDM
- gives a clear commercial trigger for the rest of the flow

### 2. Manufacturer fulfillment and invoicing

MediCore receives the order, prepares fulfillment, and issues an `XML invoice` tied back to the same PO reference.

Why it demos well:

- shows cross-format processing from X12 inbound to XML outbound
- keeps business references consistent across the flow
- makes AP / AR reconciliation easy to explain

### 3. Logistics orchestration

MediCore sends `EDIFACT IFTMIN` shipment instructions to GlobalTrade. GlobalTrade then sends `EDIFACT DESADV` shipment advice and XML shipment visibility updates toward CareBridge.

Why it demos well:

- demonstrates partner-to-partner logistics integration
- uses standard transport and despatch message families
- lets you show message status, delivery state, and shipment traceability

### 4. Receivables finance and settlement

Once the invoice is approved, MediCore sends a finance request to NexusPay. NexusPay returns a remittance/settlement response in CSV form for reconciliation.

Why it demos well:

- extends the story beyond order-to-ship into order-to-cash
- shows financial messaging as part of the same partner ecosystem
- gives a strong business value narrative around working capital

## Recommended end-to-end walkthrough

### Step 0: Show agent-to-agent onboarding (optional, high-impact opener)

**Prerequisites for this step:**
- Stack is running
- A platform LLM is configured in **Admin Settings**
- An API key is ready — sign in as any demo partner (e.g. `edi@carebridge-demo.io` / `Demo@1234`), go to **Settings**, scroll to **API Keys**, click **Generate New API Key**, and copy the `bx_...` value

Set your environment variables (same port for dev and Docker):

```bash
export GW="http://localhost:3000"
export PORTAL="http://localhost:3100"
```

Open a terminal or API client and show the Exchange Agent Card:

```bash
curl $GW/.well-known/agent.json | jq .
```

Walk through the card: skills listed, auth requirements, task endpoint.

Then show a partner agent submitting an onboarding task (can be pre-scripted):

```bash
export API_KEY="bx_<key from Settings → API Keys>"

curl -X POST $GW/a2a/tasks \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "skill": "partner_onboarding",
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "We are a regional pharmacy wholesaler. We produce purchase orders in JSON from our ERP and want to receive invoice confirmations. Here is a sample: {\"poNumber\":\"PO-1001\",\"items\":[{\"sku\":\"IBUP-200\",\"qty\":500}]}" }]
    }
  }' | jq .
```

Switch to the partner portal **A2A Sessions** page and show the negotiation in progress — the Exchange Agent's mapping proposal, the proposed subscription, and the moment the session reaches `ACTIVE`.

Suggested narration:

> The platform doesn't just wait for a human to fill in a form. A partner's own AI agent can find us, negotiate the integration terms, and go live — in minutes, without any manual steps.

### Step 1: Start in CareBridge

Show that CareBridge is a pharmacy network, not a generic retailer.

Point out:

- the seeded `X12 850` purchase order
- realistic pharmacy SKUs and quantities
- requested delivery timing and replenishment context

Suggested narration:

> CareBridge is replenishing OTC inventory for its pharmacy network. The order is transmitted as a standard X12 850 to MediCore.

### Step 2: Switch to MediCore

Show MediCore as the central manufacturer.

Point out:

- inbound purchase order mapping
- outbound invoice generated against the same PO
- outbound EDIFACT shipment instruction to GlobalTrade

Suggested narration:

> MediCore receives the pharmacy order, confirms the commercial document trail, and then hands transport execution to its logistics provider.

### Step 3: Move to GlobalTrade

Show how logistics becomes a connected partner workflow.

Point out:

- inbound `IFTMIN` logistics booking
- outbound `DESADV` shipment notice
- transport-specific details like package counts, delivery ETA, and temperature handling

Suggested narration:

> GlobalTrade receives a structured shipping instruction from MediCore and turns it into an actionable shipment notice for CareBridge.

### Step 4: Return to CareBridge

Show the downstream operational benefit.

Point out:

- shipment visibility back to the buyer
- invoice receipt from MediCore
- consistent references between order, shipment, and invoice

Suggested narration:

> CareBridge can now reconcile the original order, the incoming shipment, and the invoice without manual rekeying.

### Step 5: Close with NexusPay

Show the working-capital angle.

Point out:

- MediCore financing request tied to the approved invoice
- NexusPay remittance and settlement record
- traceability from purchase order to cash event

Suggested narration:

> The platform is not just moving operational messages. It also supports the financial follow-through by connecting MediCore to its finance partner.

## Industry-standard message types used

- `X12 850` for purchase orders
- `EDIFACT IFTMIN` for shipment instructions
- `EDIFACT DESADV` for despatch / advance shipment notices
- structured `XML invoice` for billing
- `CSV remittance advice` for settlement confirmation

## A2A / MCP protocols used

- **A2A (Google Agent-to-Agent)** for multi-turn agent negotiation and task lifecycle
- **MCP (Model Context Protocol, Streamable HTTP)** for LLM tool calls against platform capabilities

## Suggested demo storyline in one sentence

CareBridge orders OTC inventory from MediCore, MediCore books GlobalTrade to deliver it, CareBridge receives shipment and invoice visibility, and NexusPay finances the receivable.

## Best talking points

- One business scenario across four partners
- Multiple standards and formats in a single flow
- Shared references across order, shipment, invoice, and settlement
- Clear value for both operations teams and finance teams
- Partners can onboard via the human portal **or** via their own AI agent using A2A/MCP — both paths are fully supported
