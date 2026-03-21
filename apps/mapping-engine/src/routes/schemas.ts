import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SchemaService } from '../services/schemaService';

const router = Router();
const svc = new SchemaService();

// Standard business message types (partners can also enter custom names)
const STANDARD_MESSAGE_TYPES = ['orders', 'invoices', 'shipments', 'products', 'payments', 'inventory', 'acknowledgments', 'custom'];

// CDM field definitions exposed to the UI
const CDM_GROUPS = {
  envelope: ['id', 'type', 'timestamp'],
  sender: ['sender.id', 'sender.name', 'sender.email'],
  receiver: ['receiver.id', 'receiver.name'],
  order: ['order.id', 'order.date', 'order.total', 'order.currency', 'order.lineItems[].id', 'order.lineItems[].sku', 'order.lineItems[].quantity', 'order.lineItems[].price'],
  invoice: ['invoice.id', 'invoice.date', 'invoice.dueDate', 'invoice.amount'],
  shipment: ['shipment.id', 'shipment.trackingNumber', 'shipment.carrier', 'shipment.status'],
  product: ['product.id', 'product.sku', 'product.name', 'product.price'],
  address: ['address.street', 'address.city', 'address.state', 'address.zip', 'address.country'],
};

const registerSchema = z.object({
  format: z.enum(['json', 'xml', 'csv', 'edi-x12', 'edifact']),
  messageType: z.string().min(1).max(100).toLowerCase(),
  samplePayload: z.string().min(1),
  sampleSchema: z.string().optional(),   // JSON Schema, XSD, CSV headers, EDI spec, etc.
  direction: z.enum(['outbound', 'inbound']).optional().default('outbound'),
  description: z.string().optional(),
});

// GET /api/mappings/schemas/cdm — expose CDM field groups (must be before /:partnerId)
router.get('/cdm', (_req: Request, res: Response) => {
  res.json({ success: true, data: { groups: CDM_GROUPS, standardMessageTypes: STANDARD_MESSAGE_TYPES } });
});

// GET /api/mappings/schemas/:partnerId/active — active schemas only (for subscription viewers)
router.get('/:partnerId/active', async (req: Request, res: Response) => {
  const schemas = await svc.listActiveForPartner(req.params.partnerId);
  res.json({ success: true, data: schemas });
});

// POST /api/mappings/schemas — register partner schema
router.post('/', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  try {
    const schema = await svc.register(partnerId, parsed.data);
    res.status(201).json({ success: true, data: schema });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Schema registration failed';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/mappings/schemas/:partnerId — get all partner schemas
router.get('/:partnerId', async (req: Request, res: Response) => {
  const schemas = await svc.listForPartner(req.params.partnerId);
  res.json({ success: true, data: schemas });
});

// POST /api/mappings/schemas/:id/approve — human approves AI mapping
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const schema = await svc.approveMapping(req.params.id);
    res.json({ success: true, data: schema });
  } catch {
    res.status(404).json({ success: false, error: 'Schema not found' });
  }
});

// PATCH /api/mappings/schemas/:id/rules — save manually edited mapping rules
router.patch('/:id/rules', async (req: Request, res: Response) => {
  const { mappingRules } = req.body as { mappingRules: unknown };
  if (!Array.isArray(mappingRules)) {
    res.status(400).json({ success: false, error: 'mappingRules must be an array' });
    return;
  }
  try {
    const schema = await svc.updateRules(req.params.id, mappingRules);
    res.json({ success: true, data: schema });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Update failed';
    res.status(404).json({ success: false, error: message });
  }
});

// DELETE /api/mappings/schemas/:id — remove a schema version
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await svc.deleteSchema(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    const status = message.includes('active version') ? 409 : 404;
    res.status(status).json({ success: false, error: message });
  }
});

// POST /api/mappings/schemas/:id/activate — set as the active version for its format+messageType
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const schema = await svc.activateSchema(req.params.id);
    res.json({ success: true, data: schema });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Activation failed';
    res.status(404).json({ success: false, error: message });
  }
});

export { router as schemaRoutes };
