# Pharmaceutical Demo Guide

This demo is designed around a single, believable B2B healthcare supply-chain story.

## Demo companies

- `CareBridge Pharmacy Network` is the downstream customer. It operates pharmacy outlets and sends replenishment orders for OTC products.
- `MediCore Systems` is the pharmaceutical manufacturer and primary supplier.
- `GlobalTrade Logistics` is the transport and cold-chain logistics provider.
- `NexusPay Finance` is the receivables finance partner for MediCore.

## Core use cases

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

## Suggested demo storyline in one sentence

CareBridge orders OTC inventory from MediCore, MediCore books GlobalTrade to deliver it, CareBridge receives shipment and invoice visibility, and NexusPay finances the receivable.

## Best talking points

- One business scenario across four partners
- Multiple standards and formats in a single flow
- Shared references across order, shipment, invoice, and settlement
- Clear value for both operations teams and finance teams
