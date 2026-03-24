import { Router, Request, Response } from 'express';
import { createLogger } from '@bx/logger';
import { apiKeyMiddleware, AuthenticatedRequest } from '../middleware/apiKey';
import { ProvisioningClient } from '../services/provisioningClient';
import type {
  MCPRequest, MCPResponse, MCPInitializeResult, MCPListToolsResult,
  MCPCallToolResult, MCPTool,
} from '@bx/a2a-sdk';

const router = Router();
const logger = createLogger('exchange-agent:mcp');
const provisioning = new ProvisioningClient();

const PLATFORM_TOOLS: MCPTool[] = [
  {
    name: 'get_platform_info',
    description: 'Get information about the Business Exchange platform: supported formats, capabilities, and available data feed types.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'register_partner',
    description: 'Register a new partner on the platform. Returns partner ID and API credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        name:             { type: 'string', description: 'Company name' },
        domain:           { type: 'string', description: 'Company domain (e.g. acme.com)' },
        contactEmail:     { type: 'string', description: 'Primary contact email' },
        password:         { type: 'string', description: 'Initial portal password (min 8 chars)' },
        webhookUrl:       { type: 'string', description: 'HTTPS URL for message delivery (optional)' },
        supportedFormats: { type: 'array', items: { type: 'string' }, description: 'Formats: json, xml, csv, edi-x12, edifact' },
      },
      required: ['name', 'domain', 'contactEmail', 'password'],
    },
  },
  {
    name: 'discover_subscriptions',
    description: 'List available data feeds on the platform that this partner can subscribe to.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'submit_schema_sample',
    description: 'Submit a sample payload to trigger AI-powered schema inference and receive proposed mapping rules.',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId:     { type: 'string', description: 'Partner ID (from register_partner)' },
        samplePayload: { type: 'string', description: 'Raw sample payload (JSON string, XML, CSV, or EDI)' },
        format:        { type: 'string', description: 'Payload format: json, xml, csv, edi-x12, edifact' },
        messageType:   { type: 'string', description: 'Message type: ORDERS, INVOICES, SHIPMENTS, etc.' },
        direction:     { type: 'string', description: 'outbound (partner sends) or inbound (partner receives)' },
      },
      required: ['partnerId', 'samplePayload', 'format', 'messageType', 'direction'],
    },
  },
  {
    name: 'request_subscription',
    description: 'Subscribe this partner to a data feed from a provider partner.',
    inputSchema: {
      type: 'object',
      properties: {
        subscriberPartnerId: { type: 'string', description: 'Partner ID of the subscriber' },
        providerPartnerId:   { type: 'string', description: 'Partner ID of the data feed provider' },
      },
      required: ['subscriberPartnerId', 'providerPartnerId'],
    },
  },
  {
    name: 'get_onboarding_status',
    description: 'Check the current onboarding status for a partner.',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string', description: 'Partner ID to check' },
      },
      required: ['partnerId'],
    },
  },
];

function ok(id: string | number, result: unknown): MCPResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: string | number, code: number, message: string): MCPResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// MCP uses JSON-RPC 2.0. Public initialize, everything else needs API key.
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as MCPRequest;

  // initialize — no auth required
  if (body.method === 'initialize') {
    const result: MCPInitializeResult = {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'business-exchange-mcp', version: '1.0.0' },
    };
    res.json(ok(body.id, result));
    return;
  }

  // All other methods require API key
  await new Promise<void>((resolve) => apiKeyMiddleware(req as AuthenticatedRequest, res, () => resolve()));
  if (res.headersSent) return;

  if (body.method === 'tools/list') {
    const result: MCPListToolsResult = { tools: PLATFORM_TOOLS };
    res.json(ok(body.id, result));
    return;
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args = {} } = (body.params ?? {}) as { name: string; arguments: Record<string, unknown> };
    try {
      const result = await callTool(name, args, (req as AuthenticatedRequest).partnerId);
      res.json(ok(body.id, result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Tool execution failed';
      logger.error({ err: e, tool: name }, 'MCP tool error');
      res.json(ok(body.id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true } as MCPCallToolResult));
    }
    return;
  }

  res.json(err(body.id, -32601, 'Method not found'));
});

async function callTool(
  name: string,
  args: Record<string, unknown>,
  _callerId?: string,
): Promise<MCPCallToolResult> {
  const text = (t: string): MCPCallToolResult => ({ content: [{ type: 'text', text: t }] });
  const json = (obj: unknown): MCPCallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

  switch (name) {
    case 'get_platform_info':
      return json({
        name: 'Business Exchange',
        description: 'B2B integration platform for multi-format message exchange',
        supportedFormats: ['json', 'xml', 'csv', 'edi-x12', 'edifact'],
        messageTypes: ['ORDERS', 'INVOICES', 'SHIPMENTS', 'PRODUCTS', 'PAYMENTS', 'INVENTORY', 'ACKNOWLEDGMENTS'],
        capabilities: ['schema-inference', 'ai-mapping', 'webhook-delivery', 'retry', 'drift-detection'],
      });

    case 'register_partner': {
      const result = await provisioning.registerPartner({
        name:             args.name as string,
        domain:           args.domain as string,
        contactEmail:     args.contactEmail as string,
        password:         args.password as string,
        webhookUrl:       args.webhookUrl as string | undefined,
        supportedFormats: (args.supportedFormats as string[]) ?? ['json'],
      });
      return json({ success: true, ...result });
    }

    case 'discover_subscriptions': {
      const subs = await provisioning.listAvailableSubscriptions(
        process.env.INTERNAL_SERVICE_TOKEN ?? '',
      );
      return json({ subscriptions: subs });
    }

    case 'submit_schema_sample': {
      const inferred = await provisioning.inferSchema({
        partnerId:          args.partnerId as string,
        samplePayload:      args.samplePayload as string,
        format:             args.format as string,
        messageType:        args.messageType as string,
        direction:          args.direction as 'outbound' | 'inbound',
        internalAuthToken:  process.env.INTERNAL_SERVICE_TOKEN ?? '',
      });
      return json({ success: true, ...inferred });
    }

    case 'request_subscription': {
      const sub = await provisioning.createSubscription({
        subscriberPartnerId: args.subscriberPartnerId as string,
        providerPartnerId:   args.providerPartnerId as string,
        internalAuthToken:   process.env.INTERNAL_SERVICE_TOKEN ?? '',
      });
      return json({ success: true, ...sub });
    }

    case 'get_onboarding_status': {
      return text(`Partner ${args.partnerId} — check the partner portal for current status.`);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export { router as mcpRouter };
