import bcrypt from 'bcryptjs';
import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';

// Two-partner demo story:
//   CareBridge Pharmacy Network  →  MediCore Systems      EDI X12 850 purchase order  → CDM → JSON
//   MediCore Systems             →  CareBridge Pharmacy Network  XML invoice            → CDM → JSON
//
// This showcases the core platform value: two partners speaking different wire formats,
// routed through CDM so neither has to know about the other's format.

const DEMO_PARTNERS = [
  {
    key: 'carebridge',
    name: 'CareBridge Pharmacy Network',
    domain: 'carebridge-demo.io',
    contactEmail: 'edi@carebridge-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://httpbin.org/post',
    formats: ['edi-x12', 'json'],
    messageTypes: ['purchase_order', 'invoice'],
    description: 'Regional pharmacy chain — sends EDI X12 purchase orders, receives JSON invoices',
  },
  {
    key: 'medicore',
    name: 'MediCore Systems',
    domain: 'medicore-demo.io',
    contactEmail: 'integration@medicore-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://httpbin.org/post',
    formats: ['xml', 'json'],
    messageTypes: ['purchase_order', 'invoice'],
    description: 'Pharmaceutical manufacturer — sends XML invoices, receives JSON purchase orders',
  },
];

// ── Sample payloads ────────────────────────────────────────────────────────────

const CB_PO_X12 = `ISA*00*          *00*          *ZZ*CAREBRIDGE     *ZZ*MEDICORE       *260315*0900*^*00501*000000921*0*P*:~
GS*PO*CAREBRIDGE*MEDICORE*20260315*0900*921*X*005010~
ST*850*0001~
BEG*00*SA*PO-CB-2026-1042**20260315~
CUR*BY*USD~
DTM*002*20260322~
N1*BY*CareBridge Pharmacy Network*92*CAREBRIDGE-001~
N3*450 Wellness Avenue~
N4*Chicago*IL*60611*US~
PER*BD*Pharmacy Procurement*EM*edi@carebridge-demo.io~
N1*SE*MediCore Systems*92*MEDICORE-001~
N3*200 MedTech Blvd~
N4*Boston*MA*02110*US~
PO1*1*240*CS*18.75*PE*VP*CB-IBU-200-100*PI*MC-IBU-200-100~
PID*F****MediCore Ibuprofen 200mg 100-count bottle~
PO1*2*180*CS*24.40*PE*VP*CB-CF-24*PI*MC-CF-24~
PID*F****MediCore Cold and Flu Relief 24-count~
PO1*3*120*CS*14.10*PE*VP*CB-VITD-60*PI*MC-VITD-60~
PID*F****MediCore Vitamin D3 60-count softgels~
CTT*3*540~
AMT*TT*10584.00~
SE*22*0001~
GE*1*921~
IEA*1*000000921~`;

const CB_PO_CDM = JSON.stringify({
  id: 'PO-CB-2026-1042',
  type: 'order',
  timestamp: '2026-03-15T09:00:00Z',
  sender: { id: 'CAREBRIDGE-001', name: 'CareBridge Pharmacy Network' },
  receiver: { id: 'MEDICORE-001', name: 'MediCore Systems' },
  order: {
    id: 'PO-CB-2026-1042',
    date: '2026-03-15',
    requestedDelivery: '2026-03-22',
    currency: 'USD',
    total: 10584.00,
    lineItems: [
      { sku: 'MC-IBU-200-100', buyerSku: 'CB-IBU-200-100', description: 'MediCore Ibuprofen 200mg 100-count bottle',  quantity: 240, unitPrice: 18.75, total: 4500.00 },
      { sku: 'MC-CF-24',       buyerSku: 'CB-CF-24',       description: 'MediCore Cold and Flu Relief 24-count',      quantity: 180, unitPrice: 24.40, total: 4392.00 },
      { sku: 'MC-VITD-60',     buyerSku: 'CB-VITD-60',     description: 'MediCore Vitamin D3 60-count softgels',      quantity: 120, unitPrice: 14.10, total: 1692.00 },
    ],
  },
}, null, 2);

// MediCore ERP expects JSON purchase orders
const CB_PO_MAPPED_JSON = JSON.stringify({
  orderId: 'PO-CB-2026-1042',
  orderDate: '2026-03-15',
  requestedDelivery: '2026-03-22',
  buyer: { id: 'CAREBRIDGE-001', name: 'CareBridge Pharmacy Network' },
  seller: { id: 'MEDICORE-001', name: 'MediCore Systems' },
  lineItems: [
    { sku: 'MC-IBU-200-100', buyerSku: 'CB-IBU-200-100', qty: 240, unitPrice: 18.75, lineTotal: 4500.00 },
    { sku: 'MC-CF-24',       buyerSku: 'CB-CF-24',       qty: 180, unitPrice: 24.40, lineTotal: 4392.00 },
    { sku: 'MC-VITD-60',     buyerSku: 'CB-VITD-60',     qty: 120, unitPrice: 14.10, lineTotal: 1692.00 },
  ],
  currency: 'USD',
  total: 10584.00,
}, null, 2);

const MC_INVOICE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PharmaInvoice xmlns="http://medicore-demo.io/invoice/v1">
  <Header>
    <InvoiceNumber>MC-INV-2026-1042</InvoiceNumber>
    <InvoiceDate>2026-03-17</InvoiceDate>
    <DueDate>2026-04-16</DueDate>
    <Currency>USD</Currency>
    <PurchaseOrderRef>PO-CB-2026-1042</PurchaseOrderRef>
    <PaymentTerms>NET30</PaymentTerms>
  </Header>
  <Supplier>
    <SupplierCode>MEDICORE-001</SupplierCode>
    <SupplierName>MediCore Systems</SupplierName>
  </Supplier>
  <Customer>
    <CustomerCode>CAREBRIDGE-001</CustomerCode>
    <CustomerName>CareBridge Pharmacy Network</CustomerName>
  </Customer>
  <InvoiceLines>
    <Line seq="1">
      <SupplierSku>MC-IBU-200-100</SupplierSku>
      <BuyerSku>CB-IBU-200-100</BuyerSku>
      <Description>MediCore Ibuprofen 200mg 100-count bottle</Description>
      <ShipQty>240</ShipQty>
      <UOM>CS</UOM>
      <UnitPrice>18.75</UnitPrice>
      <LineAmount>4500.00</LineAmount>
    </Line>
    <Line seq="2">
      <SupplierSku>MC-CF-24</SupplierSku>
      <BuyerSku>CB-CF-24</BuyerSku>
      <Description>MediCore Cold and Flu Relief 24-count</Description>
      <ShipQty>180</ShipQty>
      <UOM>CS</UOM>
      <UnitPrice>24.40</UnitPrice>
      <LineAmount>4392.00</LineAmount>
    </Line>
    <Line seq="3">
      <SupplierSku>MC-VITD-60</SupplierSku>
      <BuyerSku>CB-VITD-60</BuyerSku>
      <Description>MediCore Vitamin D3 60-count softgels</Description>
      <ShipQty>120</ShipQty>
      <UOM>CS</UOM>
      <UnitPrice>14.10</UnitPrice>
      <LineAmount>1692.00</LineAmount>
    </Line>
  </InvoiceLines>
  <Totals>
    <SubTotal>10584.00</SubTotal>
    <TaxAmount>0.00</TaxAmount>
    <TotalAmount>10584.00</TotalAmount>
  </Totals>
</PharmaInvoice>`;

const MC_INVOICE_CDM = JSON.stringify({
  id: 'MC-INV-2026-1042',
  type: 'invoice',
  timestamp: '2026-03-17T00:00:00Z',
  sender: { id: 'MEDICORE-001', name: 'MediCore Systems' },
  receiver: { id: 'CAREBRIDGE-001', name: 'CareBridge Pharmacy Network' },
  invoice: {
    id: 'MC-INV-2026-1042',
    number: 'MC-INV-2026-1042',
    date: '2026-03-17',
    dueDate: '2026-04-16',
    currency: 'USD',
    subtotal: 10584.00,
    taxRate: 0,
    taxAmount: 0.00,
    total: 10584.00,
    status: 'open',
    paymentTerms: 'NET30',
    referenceOrderId: 'PO-CB-2026-1042',
  },
}, null, 2);

// CareBridge AP system expects JSON invoices
const MC_INVOICE_MAPPED_JSON = JSON.stringify({
  invoiceId: 'MC-INV-2026-1042',
  invoiceDate: '2026-03-17',
  dueDate: '2026-04-16',
  poRef: 'PO-CB-2026-1042',
  paymentTerms: 'NET30',
  supplier: { id: 'MEDICORE-001', name: 'MediCore Systems' },
  customer: { id: 'CAREBRIDGE-001', name: 'CareBridge Pharmacy Network' },
  lines: [
    { sku: 'CB-IBU-200-100', description: 'MediCore Ibuprofen 200mg 100-count bottle', qty: 240, unitPrice: 18.75, lineTotal: 4500.00 },
    { sku: 'CB-CF-24',       description: 'MediCore Cold and Flu Relief 24-count',      qty: 180, unitPrice: 24.40, lineTotal: 4392.00 },
    { sku: 'CB-VITD-60',     description: 'MediCore Vitamin D3 60-count softgels',      qty: 120, unitPrice: 14.10, lineTotal: 1692.00 },
  ],
  currency: 'USD',
  subtotal: 10584.00,
  taxAmount: 0.00,
  total: 10584.00,
}, null, 2);

// ── Schemas ────────────────────────────────────────────────────────────────────

interface DemoSchema {
  partnerKey: string;
  format: string;
  messageType: string;
  direction: 'outbound' | 'inbound';
  samplePayload: string;
  inferredSchema: Record<string, unknown>;
  mappingRules: Array<{ sourceField: string; targetField: string; transform?: string; confidence: number }>;
}

const DEMO_SCHEMAS: DemoSchema[] = [
  // ── Flow 1: CareBridge EDI X12 850 → CDM → MediCore JSON ─────────────────
  {
    partnerKey: 'carebridge',
    format: 'edi-x12',
    messageType: 'purchase_order',
    direction: 'outbound',
    samplePayload: CB_PO_X12,
    inferredSchema: {
      type: 'object',
      description: 'ANSI X12 850 purchase order from CareBridge to MediCore',
      properties: {
        'BEG.03': { type: 'string', description: 'Purchase order number' },
        'BEG.05': { type: 'string', description: 'Purchase order date (YYYYMMDD)' },
        'DTM.02[002]': { type: 'string', description: 'Requested delivery date' },
        'N1.02[BY]': { type: 'string', description: 'Buyer name' },
        'N1.04[BY]': { type: 'string', description: 'Buyer code' },
        'N1.02[SE]': { type: 'string', description: 'Seller name' },
        'N1.04[SE]': { type: 'string', description: 'Seller code' },
        'PO1.02': { type: 'number', description: 'Line quantity' },
        'PO1.04': { type: 'number', description: 'Unit price' },
        'PO1.07': { type: 'string', description: 'Buyer SKU' },
        'PO1.09': { type: 'string', description: 'Supplier SKU' },
        'AMT.02': { type: 'number', description: 'Total order amount' },
      },
    },
    mappingRules: [
      { sourceField: 'N1.04[BY]',    targetField: 'sender.id',                     confidence: 0.95 },
      { sourceField: 'N1.02[BY]',    targetField: 'sender.name',                   confidence: 0.96 },
      { sourceField: 'N1.04[SE]',    targetField: 'receiver.id',                   confidence: 0.95 },
      { sourceField: 'N1.02[SE]',    targetField: 'receiver.name',                 confidence: 0.96 },
      { sourceField: 'BEG.03',       targetField: 'order.id',                      confidence: 0.98 },
      { sourceField: 'BEG.05',       targetField: 'order.date',                    confidence: 0.96, transform: 'YYYYMMDD -> ISO date' },
      { sourceField: 'DTM.02[002]',  targetField: 'order.requestedDelivery',       confidence: 0.94, transform: 'YYYYMMDD -> ISO date' },
      { sourceField: 'CUR.02',       targetField: 'order.currency',                confidence: 0.97 },
      { sourceField: 'PO1.07[1]',    targetField: 'order.lineItems[0].sku',        confidence: 0.91, transform: 'Use buyer SKU (VP qualifier)' },
      { sourceField: 'PO1.09[1]',    targetField: 'order.lineItems[0].buyerSku',   confidence: 0.91, transform: 'Use supplier SKU (PI qualifier)' },
      { sourceField: 'PO1.02[1]',    targetField: 'order.lineItems[0].quantity',   confidence: 0.95 },
      { sourceField: 'PO1.04[1]',    targetField: 'order.lineItems[0].unitPrice',  confidence: 0.95 },
      { sourceField: 'AMT.02',       targetField: 'order.total',                   confidence: 0.97 },
    ],
  },
  {
    partnerKey: 'medicore',
    format: 'json',
    messageType: 'purchase_order',
    direction: 'inbound',
    samplePayload: CB_PO_MAPPED_JSON,
    inferredSchema: {
      type: 'object',
      description: 'MediCore ERP inbound JSON purchase order',
      properties: {
        orderId:           { type: 'string' },
        orderDate:         { type: 'string', format: 'date' },
        requestedDelivery: { type: 'string', format: 'date' },
        buyer:             { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        seller:            { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        lineItems:         { type: 'array' },
        currency:          { type: 'string' },
        total:             { type: 'number' },
      },
    },
    mappingRules: [
      { sourceField: 'sender.id',                     targetField: 'buyer.id',               confidence: 0.95 },
      { sourceField: 'sender.name',                   targetField: 'buyer.name',             confidence: 0.96 },
      { sourceField: 'receiver.id',                   targetField: 'seller.id',              confidence: 0.95 },
      { sourceField: 'receiver.name',                 targetField: 'seller.name',            confidence: 0.96 },
      { sourceField: 'order.id',                      targetField: 'orderId',                confidence: 0.98 },
      { sourceField: 'order.date',                    targetField: 'orderDate',              confidence: 0.97 },
      { sourceField: 'order.requestedDelivery',       targetField: 'requestedDelivery',      confidence: 0.94 },
      { sourceField: 'order.currency',                targetField: 'currency',               confidence: 0.97 },
      { sourceField: 'order.lineItems[0].sku',        targetField: 'lineItems[0].sku',       confidence: 0.93 },
      { sourceField: 'order.lineItems[0].buyerSku',   targetField: 'lineItems[0].buyerSku',  confidence: 0.92 },
      { sourceField: 'order.lineItems[0].quantity',   targetField: 'lineItems[0].qty',       confidence: 0.95 },
      { sourceField: 'order.lineItems[0].unitPrice',  targetField: 'lineItems[0].unitPrice', confidence: 0.95 },
      { sourceField: 'order.total',                   targetField: 'total',                  confidence: 0.97 },
    ],
  },

  // ── Flow 2: MediCore XML invoice → CDM → CareBridge JSON ──────────────────
  {
    partnerKey: 'medicore',
    format: 'xml',
    messageType: 'invoice',
    direction: 'outbound',
    samplePayload: MC_INVOICE_XML,
    inferredSchema: {
      type: 'object',
      description: 'MediCore XML PharmaInvoice issued to CareBridge',
      properties: {
        'Header.InvoiceNumber':           { type: 'string' },
        'Header.InvoiceDate':             { type: 'string', format: 'date' },
        'Header.DueDate':                 { type: 'string', format: 'date' },
        'Header.PurchaseOrderRef':        { type: 'string' },
        'Header.PaymentTerms':            { type: 'string' },
        'Supplier.SupplierCode':          { type: 'string' },
        'Supplier.SupplierName':          { type: 'string' },
        'Customer.CustomerCode':          { type: 'string' },
        'Customer.CustomerName':          { type: 'string' },
        'InvoiceLines.Line[0].SupplierSku': { type: 'string' },
        'InvoiceLines.Line[0].BuyerSku':  { type: 'string' },
        'InvoiceLines.Line[0].ShipQty':   { type: 'number' },
        'InvoiceLines.Line[0].UnitPrice': { type: 'number' },
        'Totals.SubTotal':                { type: 'number' },
        'Totals.TotalAmount':             { type: 'number' },
      },
    },
    mappingRules: [
      { sourceField: 'PharmaInvoice.Supplier.SupplierCode',           targetField: 'sender.id',                      confidence: 0.95 },
      { sourceField: 'PharmaInvoice.Supplier.SupplierName',           targetField: 'sender.name',                    confidence: 0.96 },
      { sourceField: 'PharmaInvoice.Customer.CustomerCode',           targetField: 'receiver.id',                    confidence: 0.95 },
      { sourceField: 'PharmaInvoice.Customer.CustomerName',           targetField: 'receiver.name',                  confidence: 0.96 },
      { sourceField: 'PharmaInvoice.Header.InvoiceNumber',            targetField: 'invoice.id',                     confidence: 0.99 },
      { sourceField: 'PharmaInvoice.Header.InvoiceDate',              targetField: 'invoice.date',                   confidence: 0.98 },
      { sourceField: 'PharmaInvoice.Header.DueDate',                  targetField: 'invoice.dueDate',                confidence: 0.97 },
      { sourceField: 'PharmaInvoice.Header.PurchaseOrderRef',         targetField: 'invoice.referenceOrderId',       confidence: 0.96 },
      { sourceField: 'PharmaInvoice.Header.PaymentTerms',             targetField: 'invoice.paymentTerms',           confidence: 0.95 },
      { sourceField: 'PharmaInvoice.Header.Currency',                 targetField: 'invoice.currency',               confidence: 0.98 },
      { sourceField: 'PharmaInvoice.Totals.SubTotal',                 targetField: 'invoice.subtotal',               confidence: 0.97 },
      { sourceField: 'PharmaInvoice.Totals.TotalAmount',              targetField: 'invoice.total',                  confidence: 0.99 },
      { sourceField: 'PharmaInvoice.InvoiceLines.Line[0].SupplierSku', targetField: 'invoice.lineItems[0].sku',      confidence: 0.93 },
      { sourceField: 'PharmaInvoice.InvoiceLines.Line[0].BuyerSku',   targetField: 'invoice.lineItems[0].buyerSku', confidence: 0.92 },
      { sourceField: 'PharmaInvoice.InvoiceLines.Line[0].ShipQty',    targetField: 'invoice.lineItems[0].quantity', confidence: 0.95 },
      { sourceField: 'PharmaInvoice.InvoiceLines.Line[0].UnitPrice',  targetField: 'invoice.lineItems[0].unitPrice', confidence: 0.96 },
    ],
  },
  {
    partnerKey: 'carebridge',
    format: 'json',
    messageType: 'invoice',
    direction: 'inbound',
    samplePayload: MC_INVOICE_MAPPED_JSON,
    inferredSchema: {
      type: 'object',
      description: 'CareBridge AP system inbound JSON invoice',
      properties: {
        invoiceId:    { type: 'string' },
        invoiceDate:  { type: 'string', format: 'date' },
        dueDate:      { type: 'string', format: 'date' },
        poRef:        { type: 'string' },
        paymentTerms: { type: 'string' },
        supplier:     { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        customer:     { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        lines:        { type: 'array' },
        currency:     { type: 'string' },
        subtotal:     { type: 'number' },
        taxAmount:    { type: 'number' },
        total:        { type: 'number' },
      },
    },
    mappingRules: [
      { sourceField: 'sender.id',                      targetField: 'supplier.id',            confidence: 0.95 },
      { sourceField: 'sender.name',                    targetField: 'supplier.name',          confidence: 0.96 },
      { sourceField: 'receiver.id',                    targetField: 'customer.id',            confidence: 0.95 },
      { sourceField: 'receiver.name',                  targetField: 'customer.name',          confidence: 0.96 },
      { sourceField: 'invoice.id',                     targetField: 'invoiceId',              confidence: 0.99 },
      { sourceField: 'invoice.date',                   targetField: 'invoiceDate',            confidence: 0.98 },
      { sourceField: 'invoice.dueDate',                targetField: 'dueDate',                confidence: 0.97 },
      { sourceField: 'invoice.referenceOrderId',       targetField: 'poRef',                  confidence: 0.96 },
      { sourceField: 'invoice.paymentTerms',           targetField: 'paymentTerms',           confidence: 0.95 },
      { sourceField: 'invoice.currency',               targetField: 'currency',               confidence: 0.98 },
      { sourceField: 'invoice.subtotal',               targetField: 'subtotal',               confidence: 0.97 },
      { sourceField: 'invoice.taxAmount',              targetField: 'taxAmount',              confidence: 0.95 },
      { sourceField: 'invoice.total',                  targetField: 'total',                  confidence: 0.99 },
      { sourceField: 'invoice.lineItems[0].sku',       targetField: 'lines[0].sku',           confidence: 0.93 },
      { sourceField: 'invoice.lineItems[0].buyerSku',  targetField: 'lines[0].sku',           confidence: 0.92, transform: 'Prefer buyer SKU as CareBridge item master key' },
      { sourceField: 'invoice.lineItems[0].quantity',  targetField: 'lines[0].qty',           confidence: 0.95 },
      { sourceField: 'invoice.lineItems[0].unitPrice', targetField: 'lines[0].unitPrice',     confidence: 0.96 },
    ],
  },
];

// ── Seeded message log ─────────────────────────────────────────────────────────
// Pre-built with full CDM + mapped payload so the message detail view shows a
// complete, working round-trip immediately after demo is enabled.

interface DemoMessage {
  senderKey: string;
  receiverKey: string;
  format: string;
  messageType: string;
  status: string;
  rawPayload: string;
  cdmPayload: string;
  mappedPayload: string;
  outputFormat: string;
  // schemaKey matches `${partnerKey}-${direction}-${format}-${messageType}`
  outboundSchemaKey: string;
}

const DEMO_MESSAGES: DemoMessage[] = [
  {
    senderKey: 'carebridge',
    receiverKey: 'medicore',
    format: 'edi-x12',
    messageType: 'purchase_order',
    status: 'delivered',
    rawPayload: CB_PO_X12,
    cdmPayload: CB_PO_CDM,
    mappedPayload: CB_PO_MAPPED_JSON,
    outputFormat: 'json',
    outboundSchemaKey: 'carebridge-outbound-edi-x12-purchase_order',
  },
  {
    senderKey: 'medicore',
    receiverKey: 'carebridge',
    format: 'xml',
    messageType: 'invoice',
    status: 'delivered',
    rawPayload: MC_INVOICE_XML,
    cdmPayload: MC_INVOICE_CDM,
    mappedPayload: MC_INVOICE_MAPPED_JSON,
    outputFormat: 'json',
    outboundSchemaKey: 'medicore-outbound-xml-invoice',
  },
];

export class DemoService {
  private db = getPool();

  async getSetting(key: string): Promise<string | null> {
    const { rows } = await this.db.query(
      'SELECT value FROM system_settings WHERE key = $1', [key]
    );
    return rows.length ? (rows[0] as { value: string }).value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const { rows } = await this.db.query('SELECT key, value FROM system_settings ORDER BY key');
    return Object.fromEntries((rows as { key: string; value: string }[]).map(r => [r.key, r.value]));
  }

  async isDemoEnabled(): Promise<boolean> {
    const val = await this.getSetting('demo_mode');
    return val === 'true';
  }

  async enableDemo(): Promise<{ added: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = await bcrypt.hash('Demo@1234', 10);

      // 1. Create demo partners
      const partnerIdByKey: Record<string, string> = {};
      let added = 0;

      for (const p of DEMO_PARTNERS) {
        const exists = await client.query('SELECT id FROM partners WHERE domain = $1', [p.domain]);
        if (exists.rows.length) {
          partnerIdByKey[p.key] = (exists.rows[0] as { id: string }).id;
          continue;
        }

        const partnerId = generateId();
        partnerIdByKey[p.key] = partnerId;

        await client.query(
          `INSERT INTO partners
             (id, name, domain, contact_email, webhook_url, supported_formats,
              supported_message_types, status, is_demo, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',true,NOW(),NOW())`,
          [partnerId, p.name, p.domain, p.contactEmail, p.webhookUrl, p.formats, p.messageTypes]
        );
        await client.query(
          `INSERT INTO auth_users (id, partner_id, email, password_hash, scopes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (email) DO NOTHING`,
          [
            generateId(), partnerId, p.contactEmail, passwordHash,
            ['partner:read', 'partner:write', 'subscription:read', 'subscription:write',
             'integration:send', 'mapping:read', 'mapping:write', 'agent:read'],
          ]
        );
        added++;
      }

      // 2. Create a single bidirectional subscription between the two partners
      const carebridgeId = partnerIdByKey['carebridge'];
      const medicoreId   = partnerIdByKey['medicore'];

      const subRes = await client.query(
        `INSERT INTO subscriptions
           (subscriber_partner_id, provider_partner_id, status, approved_at, created_at, updated_at)
         VALUES ($1,$2,'active',NOW(),NOW(),NOW())
         ON CONFLICT (subscriber_partner_id, provider_partner_id) DO UPDATE
           SET status = 'active', approved_at = NOW(), updated_at = NOW()
         RETURNING id`,
        [carebridgeId, medicoreId]
      );
      const subscriptionId = (subRes.rows[0] as { id: string }).id;

      // 3. Seed schemas and collect their IDs
      const schemaIdByKey: Record<string, string> = {};

      for (const schema of DEMO_SCHEMAS) {
        const partnerId = partnerIdByKey[schema.partnerKey];
        if (!partnerId) continue;

        const allConfident = schema.mappingRules.every(r => r.confidence >= 0.85);
        const status = allConfident ? 'auto_approved' : 'pending_review';

        const schemaRes = await client.query<{ id: string }>(
          `INSERT INTO schema_registry
              (partner_id, format, message_type, schema_direction, sample_payload,
               inferred_schema, mapping_rules, version, status, is_active, created_with_model, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,true,$9,NOW(),NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            partnerId,
            schema.format,
            schema.messageType,
            schema.direction,
            schema.samplePayload,
            JSON.stringify(schema.inferredSchema),
            JSON.stringify(schema.mappingRules),
            status,
            'demo-seeded',
          ]
        );

        if (schemaRes.rows.length) {
          const key = `${schema.partnerKey}-${schema.direction}-${schema.format}-${schema.messageType}`;
          schemaIdByKey[key] = schemaRes.rows[0].id;
        }
      }

      // Re-fetch schema IDs for any that already existed (ON CONFLICT skipped insert)
      for (const schema of DEMO_SCHEMAS) {
        const partnerId = partnerIdByKey[schema.partnerKey];
        const key = `${schema.partnerKey}-${schema.direction}-${schema.format}-${schema.messageType}`;
        if (schemaIdByKey[key] || !partnerId) continue;

        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM schema_registry
           WHERE partner_id = $1 AND schema_direction = $2 AND format = $3 AND message_type = $4 AND is_active = true`,
          [partnerId, schema.direction, schema.format, schema.messageType]
        );
        if (rows.length) schemaIdByKey[key] = rows[0].id;
      }

      // 4. Seed messages with full CDM + mapped payload
      for (const msg of DEMO_MESSAGES) {
        const sourceId = partnerIdByKey[msg.senderKey];
        const targetId = partnerIdByKey[msg.receiverKey];
        const schemaId = schemaIdByKey[msg.outboundSchemaKey] ?? null;

        await client.query(
          `INSERT INTO messages
             (source_partner_id, target_partner_id, subscription_id, format,
              raw_payload, cdm_payload, mapped_payload, output_format,
              schema_id, status, retries, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,NOW(),NOW())`,
          [
            sourceId, targetId, subscriptionId, msg.format,
            msg.rawPayload, msg.cdmPayload, msg.mappedPayload, msg.outputFormat,
            schemaId, msg.status,
          ]
        );
      }

      await this.setSetting('demo_mode', 'true');
      await client.query('COMMIT');
      return { added };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async disableDemo(): Promise<{ removed: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: demoRows } = await client.query(
        'SELECT id FROM partners WHERE is_demo = true'
      );
      const demoIds = (demoRows as { id: string }[]).map(r => r.id);

      if (demoIds.length > 0) {
        // Delete in FK order
        await client.query(
          `DELETE FROM messages WHERE source_partner_id = ANY($1) OR target_partner_id = ANY($1)`,
          [demoIds]
        );
        await client.query(
          `DELETE FROM subscriptions WHERE subscriber_partner_id = ANY($1) OR provider_partner_id = ANY($1)`,
          [demoIds]
        );
        await client.query(`DELETE FROM schema_registry WHERE partner_id = ANY($1)`, [demoIds]);
        await client.query('DELETE FROM partners WHERE is_demo = true');
      }

      await this.setSetting('demo_mode', 'false');
      await client.query('COMMIT');
      return { removed: demoIds.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  getDemoPartners() {
    return DEMO_PARTNERS.map(p => ({
      name: p.name,
      domain: p.domain,
      email: p.contactEmail,
      password: p.password,
      formats: p.formats,
      description: p.description,
    }));
  }
}

