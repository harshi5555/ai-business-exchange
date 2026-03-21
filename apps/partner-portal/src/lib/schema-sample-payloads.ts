export const PORTAL_FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'] as const;

export const STANDARD_SCHEMA_MESSAGE_TYPES = [
  'orders',
  'invoices',
  'shipments',
  'products',
  'payments',
  'inventory',
  'acknowledgments',
] as const;

export const FORMAT_FALLBACK_SAMPLES: Record<string, string> = {
  json: `{
  "recordId": "BX-001",
  "reference": "REF-2026-001",
  "status": "active"
}`,
  xml: `<Record>
  <RecordId>BX-001</RecordId>
  <Reference>REF-2026-001</Reference>
  <Status>ACTIVE</Status>
</Record>`,
  csv: `record_id,reference,status
BX-001,REF-2026-001,active`,
  'edi-x12': `ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260317*0900*^*00501*000000001*0*P*:~
GS*FA*SENDER*RECEIVER*20260317*0900*1*X*005010~
ST*997*0001~
AK1*PO*1~
AK9*A*1*1*1~
SE*4*0001~
GE*1*1~
IEA*1*000000001~`,
  edifact: `UNB+UNOA:3+SENDER:ZZ+RECEIVER:ZZ+260317:0900+1'
UNH+1+GENRAL:D:96A:UN'
BGM+ZZZ+REF-2026-001+9'
DTM+137:20260317:102'
UNT+4+1'
UNZ+1+1'`,
};

export const SCHEMA_SAMPLE_PAYLOADS: Record<string, Record<string, string>> = {
  orders: {
    json: `{
  "orderId": "PO-CB-2026-1042",
  "orderDate": "2026-03-15T09:30:00Z",
  "buyer": { "id": "CAREBRIDGE-001", "name": "CareBridge Pharmacy Network" },
  "seller": { "id": "MEDICORE-001", "name": "MediCore Systems" },
  "lineItems": [
    { "sku": "MC-IBU-200-100", "qty": 240, "unitPrice": 18.75 },
    { "sku": "MC-CF-24", "qty": 180, "unitPrice": 24.40 }
  ],
  "currency": "USD",
  "total": 8892.00
}`,
    xml: `<PurchaseOrder>
  <OrderId>PO-CB-2026-1042</OrderId>
  <OrderDate>2026-03-15</OrderDate>
  <Buyer id="CAREBRIDGE-001">CareBridge Pharmacy Network</Buyer>
  <Seller id="MEDICORE-001">MediCore Systems</Seller>
  <LineItems>
    <Item><SKU>MC-IBU-200-100</SKU><Qty>240</Qty><UnitPrice>18.75</UnitPrice></Item>
    <Item><SKU>MC-CF-24</SKU><Qty>180</Qty><UnitPrice>24.40</UnitPrice></Item>
  </LineItems>
  <Currency>USD</Currency>
  <Total>8892.00</Total>
</PurchaseOrder>`,
    csv: `order_id,order_date,buyer_id,buyer_name,seller_id,seller_name,line_num,sku,qty,unit_price,currency
PO-CB-2026-1042,2026-03-15,CAREBRIDGE-001,CareBridge Pharmacy Network,MEDICORE-001,MediCore Systems,1,MC-IBU-200-100,240,18.75,USD
PO-CB-2026-1042,2026-03-15,CAREBRIDGE-001,CareBridge Pharmacy Network,MEDICORE-001,MediCore Systems,2,MC-CF-24,180,24.40,USD`,
    'edi-x12': `ISA*00*          *00*          *ZZ*CAREBRIDGE     *ZZ*MEDICORE       *260315*0930*^*00501*000001042*0*P*:~
GS*PO*CAREBRIDGE*MEDICORE*20260315*0930*1042*X*005010~
ST*850*0001~
BEG*00*NE*PO-CB-2026-1042**20260315~
N1*BY*CareBridge Pharmacy Network*92*CAREBRIDGE-001~
N1*SE*MediCore Systems*92*MEDICORE-001~
PO1*1*240*CS*18.75*PE*VP*MC-IBU-200-100~
PO1*2*180*CS*24.40*PE*VP*MC-CF-24~
CTT*2~
SE*8*0001~
GE*1*1042~
IEA*1*000001042~`,
    edifact: `UNB+UNOA:3+CAREBRIDGE:ZZ+MEDICORE:ZZ+260315:0930+1042'
UNH+1+ORDERS:D:96A:UN'
BGM+220+PO-CB-2026-1042+9'
DTM+137:20260315:102'
NAD+BY+CAREBRIDGE-001::92++CareBridge Pharmacy Network'
NAD+SE+MEDICORE-001::92++MediCore Systems'
LIN+1++MC-IBU-200-100:SA'
QTY+21:240'
LIN+2++MC-CF-24:SA'
QTY+21:180'
UNT+10+1'
UNZ+1+1042'`,
  },
  invoices: {
    json: `{
  "invoiceNumber": "MC-INV-2026-1042",
  "invoiceDate": "2026-03-17",
  "dueDate": "2026-04-16",
  "supplier": { "id": "MEDICORE-001", "name": "MediCore Systems" },
  "customer": { "id": "CAREBRIDGE-001", "name": "CareBridge Pharmacy Network" },
  "purchaseOrderRef": "PO-CB-2026-1042",
  "currency": "USD",
  "totalAmount": 10584.00
}`,
    xml: `<Invoice>
  <InvoiceNumber>MC-INV-2026-1042</InvoiceNumber>
  <InvoiceDate>2026-03-17</InvoiceDate>
  <DueDate>2026-04-16</DueDate>
  <Supplier id="MEDICORE-001">MediCore Systems</Supplier>
  <Customer id="CAREBRIDGE-001">CareBridge Pharmacy Network</Customer>
  <PurchaseOrderRef>PO-CB-2026-1042</PurchaseOrderRef>
  <Currency>USD</Currency>
  <TotalAmount>10584.00</TotalAmount>
</Invoice>`,
    csv: `invoice_number,invoice_date,due_date,supplier_id,customer_id,po_ref,currency,total_amount
MC-INV-2026-1042,2026-03-17,2026-04-16,MEDICORE-001,CAREBRIDGE-001,PO-CB-2026-1042,USD,10584.00`,
    'edi-x12': `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*CAREBRIDGE     *260317*1015*^*00501*000001142*0*P*:~
GS*IN*MEDICORE*CAREBRIDGE*20260317*1015*1142*X*005010~
ST*810*0001~
BIG*20260317*MC-INV-2026-1042**PO-CB-2026-1042~
N1*SU*MediCore Systems*92*MEDICORE-001~
N1*BY*CareBridge Pharmacy Network*92*CAREBRIDGE-001~
TDS*1058400~
SE*6*0001~
GE*1*1142~
IEA*1*000001142~`,
    edifact: `UNB+UNOA:3+MEDICORE:ZZ+CAREBRIDGE:ZZ+260317:1015+1142'
UNH+1+INVOIC:D:96A:UN'
BGM+380+MC-INV-2026-1042+9'
DTM+137:20260317:102'
RFF+ON:PO-CB-2026-1042'
NAD+SU+MEDICORE-001::92++MediCore Systems'
NAD+BY+CAREBRIDGE-001::92++CareBridge Pharmacy Network'
MOA+9:10584.00'
UNT+8+1'
UNZ+1+1142'`,
  },
  shipments: {
    json: `{
  "shipmentId": "GT-SHP-2026-2042",
  "orderRef": "PO-CB-2026-1042",
  "carrier": "GlobalTrade Logistics",
  "trackingNumber": "GTL-2042-558901",
  "shipDate": "2026-03-18T14:00:00Z",
  "eta": "2026-03-19T17:00:00Z",
  "status": "in_transit"
}`,
    xml: `<ShipmentNotice>
  <ShipmentId>GT-SHP-2026-2042</ShipmentId>
  <OrderRef>PO-CB-2026-1042</OrderRef>
  <Carrier>GlobalTrade Logistics</Carrier>
  <TrackingNumber>GTL-2042-558901</TrackingNumber>
  <ShipDate>2026-03-18</ShipDate>
  <EstimatedArrival>2026-03-19</EstimatedArrival>
  <Status>IN_TRANSIT</Status>
</ShipmentNotice>`,
    csv: `shipment_id,order_ref,carrier,tracking_number,ship_date,eta,status
GT-SHP-2026-2042,PO-CB-2026-1042,GlobalTrade Logistics,GTL-2042-558901,2026-03-18,2026-03-19,in_transit`,
    'edi-x12': `ISA*00*          *00*          *ZZ*GLOBALTRADE    *ZZ*CAREBRIDGE     *260318*1310*^*00501*000002042*0*P*:~
GS*SH*GLOBALTRADE*CAREBRIDGE*20260318*1310*2042*X*005010~
ST*856*0001~
BSN*00*GT-SHP-2026-2042*20260318*1310~
HL*1**S~
TD5*****M*GlobalTrade Logistics~
REF*CN*PO-CB-2026-1042~
MAN*CP*GTL-2042-558901~
SE*7*0001~
GE*1*2042~
IEA*1*000002042~`,
    edifact: `UNB+UNOA:3+GLOBALTRADE:ZZ+CAREBRIDGE:ZZ+260318:1310+2042'
UNH+1+DESADV:D:96A:UN'
BGM+351+GT-SHP-2026-2042+9'
DTM+137:20260318:102'
RFF+ON:PO-CB-2026-1042'
TDT+20++3'
PAC+54++CT'
UNT+7+1'
UNZ+1+2042'`,
  },
  products: {
    json: `{
  "sku": "MC-IBU-200-100",
  "name": "MediCore Ibuprofen 200mg 100-count bottle",
  "brand": "MediCore",
  "category": "OTC Pain Relief",
  "status": "active",
  "currency": "USD",
  "listPrice": 21.99
}`,
    xml: `<ProductCatalogItem>
  <Sku>MC-IBU-200-100</Sku>
  <Name>MediCore Ibuprofen 200mg 100-count bottle</Name>
  <Brand>MediCore</Brand>
  <Category>OTC Pain Relief</Category>
  <Status>ACTIVE</Status>
  <Currency>USD</Currency>
  <ListPrice>21.99</ListPrice>
</ProductCatalogItem>`,
    csv: `sku,name,brand,category,status,currency,list_price
MC-IBU-200-100,MediCore Ibuprofen 200mg 100-count bottle,MediCore,OTC Pain Relief,active,USD,21.99`,
    'edi-x12': `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*CAREBRIDGE     *260317*1115*^*00501*000003201*0*P*:~
GS*SC*MEDICORE*CAREBRIDGE*20260317*1115*3201*X*005010~
ST*832*0001~
BCT*PC*MC-CAT-2026-01~
LIN**VP*MC-IBU-200-100~
PID*F****MediCore Ibuprofen 200mg 100-count bottle~
CTP**LPR*21.99~
SE*6*0001~
GE*1*3201~
IEA*1*000003201~`,
    edifact: `UNB+UNOA:3+MEDICORE:ZZ+CAREBRIDGE:ZZ+260317:1115+3201'
UNH+1+PRICAT:D:96A:UN'
BGM+9+MC-CAT-2026-01+9'
LIN+1++MC-IBU-200-100:SA'
IMD+F++:::MediCore Ibuprofen 200mg 100-count bottle'
PRI+AAA:21.99'
UNT+6+1'
UNZ+1+3201'`,
  },
  payments: {
    json: `{
  "paymentRef": "MC-FIN-2026-1042",
  "requestType": "RECEIVABLES_FINANCING",
  "valueDate": "2026-03-18",
  "payer": "NexusPay Finance",
  "payee": "MediCore Systems",
  "invoiceRef": "MC-INV-2026-1042",
  "currency": "USD",
  "amount": 10372.32
}`,
    xml: `<PaymentInstruction>
  <PaymentRef>MC-FIN-2026-1042</PaymentRef>
  <RequestType>RECEIVABLES_FINANCING</RequestType>
  <ValueDate>2026-03-18</ValueDate>
  <Payer>NexusPay Finance</Payer>
  <Payee>MediCore Systems</Payee>
  <InvoiceRef>MC-INV-2026-1042</InvoiceRef>
  <Currency>USD</Currency>
  <Amount>10372.32</Amount>
</PaymentInstruction>`,
    csv: `payment_ref,request_type,value_date,payer,payee,invoice_ref,currency,amount
MC-FIN-2026-1042,RECEIVABLES_FINANCING,2026-03-18,NexusPay Finance,MediCore Systems,MC-INV-2026-1042,USD,10372.32`,
    'edi-x12': `ISA*00*          *00*          *ZZ*NEXPAY         *ZZ*MEDICORE       *260318*1022*^*00501*000004201*0*P*:~
GS*RA*NEXPAY*MEDICORE*20260318*1022*4201*X*005010~
ST*820*0001~
BPR*C*10372.32*C*ACH*CTX*01*021000021*DA*2200*01*021000021*DA*8821*20260318~
TRN*1*NX-TXN-610421~
RMR*IV*MC-INV-2026-1042**10372.32~
SE*5*0001~
GE*1*4201~
IEA*1*000004201~`,
    edifact: `UNB+UNOA:3+NEXPAY:ZZ+MEDICORE:ZZ+260318:1022+4201'
UNH+1+PAYORD:D:96A:UN'
BGM+452+MC-FIN-2026-1042+9'
DTM+137:20260318:102'
FII+OR+++NexusPay Finance'
FII+BF+++MediCore Systems'
RFF+IV:MC-INV-2026-1042'
MOA+9:10372.32'
UNT+8+1'
UNZ+1+4201'`,
  },
  inventory: {
    json: `{
  "reportId": "INV-RPT-20260315-001",
  "warehouse": "MediCore Boston DC",
  "generatedAt": "2026-03-15T08:00:00Z",
  "items": [
    { "sku": "MC-IBU-200-100", "onHand": 2400, "available": 2160 },
    { "sku": "MC-CF-24", "onHand": 1440, "available": 1260 }
  ]
}`,
    xml: `<InventoryReport>
  <ReportId>INV-RPT-20260315-001</ReportId>
  <Warehouse>MediCore Boston DC</Warehouse>
  <GeneratedAt>2026-03-15T08:00:00Z</GeneratedAt>
  <Items>
    <Item><SKU>MC-IBU-200-100</SKU><OnHand>2400</OnHand><Available>2160</Available></Item>
    <Item><SKU>MC-CF-24</SKU><OnHand>1440</OnHand><Available>1260</Available></Item>
  </Items>
</InventoryReport>`,
    csv: `report_id,warehouse,generated_at,sku,on_hand,available
INV-RPT-20260315-001,MediCore Boston DC,2026-03-15T08:00:00Z,MC-IBU-200-100,2400,2160
INV-RPT-20260315-001,MediCore Boston DC,2026-03-15T08:00:00Z,MC-CF-24,1440,1260`,
    'edi-x12': `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*CAREBRIDGE     *260315*0800*^*00501*000005101*0*P*:~
GS*IB*MEDICORE*CAREBRIDGE*20260315*0800*5101*X*005010~
ST*846*0001~
BIA*00*SI*INV-RPT-20260315-001*20260315~
LIN**VP*MC-IBU-200-100~
QTY*33*2400~
LIN**VP*MC-CF-24~
QTY*33*1440~
SE*7*0001~
GE*1*5101~
IEA*1*000005101~`,
    edifact: `UNB+UNOA:3+MEDICORE:ZZ+CAREBRIDGE:ZZ+260315:0800+5101'
UNH+1+INVRPT:D:96A:UN'
BGM+35+INV-RPT-20260315-001+9'
DTM+137:20260315:102'
LIN+1++MC-IBU-200-100:SA'
QTY+145:2400'
LIN+2++MC-CF-24:SA'
QTY+145:1440'
UNT+8+1'
UNZ+1+5101'`,
  },
  acknowledgments: {
    json: `{
  "ackId": "ACK-2026-1042-001",
  "ackType": "855",
  "originalOrderId": "PO-CB-2026-1042",
  "status": "accepted",
  "seller": "MediCore Systems",
  "buyer": "CareBridge Pharmacy Network"
}`,
    xml: `<OrderAcknowledgment>
  <AckId>ACK-2026-1042-001</AckId>
  <AckType>855</AckType>
  <OriginalOrderId>PO-CB-2026-1042</OriginalOrderId>
  <Status>ACCEPTED</Status>
  <Seller>MediCore Systems</Seller>
  <Buyer>CareBridge Pharmacy Network</Buyer>
</OrderAcknowledgment>`,
    csv: `ack_id,ack_type,original_order_id,status,seller,buyer
ACK-2026-1042-001,855,PO-CB-2026-1042,accepted,MediCore Systems,CareBridge Pharmacy Network`,
    'edi-x12': `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*CAREBRIDGE     *260315*1145*^*00501*000006101*0*P*:~
GS*PR*MEDICORE*CAREBRIDGE*20260315*1145*6101*X*005010~
ST*855*0001~
BAK*00*AC*PO-CB-2026-1042*20260315~
N1*SE*MediCore Systems*92*MEDICORE-001~
N1*BY*CareBridge Pharmacy Network*92*CAREBRIDGE-001~
ACK*IA*240*CS~
SE*6*0001~
GE*1*6101~
IEA*1*000006101~`,
    edifact: `UNB+UNOA:3+MEDICORE:ZZ+CAREBRIDGE:ZZ+260315:1145+6101'
UNH+1+ORDRSP:D:96A:UN'
BGM+231+ACK-2026-1042-001+29'
RFF+ON:PO-CB-2026-1042'
NAD+SE+MEDICORE-001::92++MediCore Systems'
NAD+BY+CAREBRIDGE-001::92++CareBridge Pharmacy Network'
UNT+6+1'
UNZ+1+6101'`,
  },
};

export function getSchemaSamplePayload(messageType: string, format: string): string {
  return (
    SCHEMA_SAMPLE_PAYLOADS[messageType]?.[format] ??
    FORMAT_FALLBACK_SAMPLES[format] ??
    FORMAT_FALLBACK_SAMPLES.json
  );
}
