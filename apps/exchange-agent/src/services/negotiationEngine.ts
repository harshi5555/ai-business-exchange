import axios from 'axios';
import OpenAI, { AzureOpenAI } from 'openai';
import { createLogger } from '@bx/logger';
import { SessionStore, AgentSession, NegotiationMessage } from './sessionStore';
import { ProvisioningClient } from './provisioningClient';

const logger = createLogger('exchange-agent:negotiation');

const PARTNER_SERVICE_URL = process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002';

interface LLMConfig {
  provider: string;
  endpoint?: string;
  model: string;
  apiKey: string;
}

async function getPlatformLLM(): Promise<LLMConfig | null> {
  try {
    const res = await axios.get<{ success: boolean; data: LLMConfig | null }>(
      `${PARTNER_SERVICE_URL}/api/partners/internal/platform-llm-config`,
      { timeout: 5000 },
    );
    return res.data.success ? res.data.data : null;
  } catch {
    return null;
  }
}

function buildLLMClient(cfg: LLMConfig): OpenAI | AzureOpenAI {
  if (cfg.provider === 'azure' || cfg.endpoint?.includes('.openai.azure.com')) {
    return new AzureOpenAI({ apiKey: cfg.apiKey, endpoint: cfg.endpoint!.replace(/\/+$/, ''), apiVersion: '2024-08-01-preview' });
  }
  if (cfg.provider === 'openai') return new OpenAI({ apiKey: cfg.apiKey });
  const base = (cfg.endpoint ?? '').replace(/\/+$/, '');
  return new OpenAI({ apiKey: cfg.apiKey || 'not-needed', baseURL: base.endsWith('/v1') ? base : `${base}/v1` });
}

const SYSTEM_PROMPT = `You are the Business Exchange platform agent. Your job is to help partner AI agents
complete their integration with the Business Exchange B2B platform.

The platform supports message exchange in JSON, XML, CSV, EDI-X12, and EDIFACT formats.
Partners can subscribe to data feeds (order updates, invoice confirmations, shipment tracking, etc.).

Your job in this negotiation:
1. Greet the partner agent and ask what data they send/receive and request a sample payload.
2. Once you have a sample, acknowledge that you will infer the schema and propose mapping rules.
3. Present the proposed mapping rules and ask the partner to confirm or suggest changes.
4. Once mapping is confirmed, ask for their webhook URL for message delivery.
5. Confirm the integration plan and indicate provisioning will begin.

Be concise, professional, and machine-friendly. Respond in JSON with this shape:
{
  "message": "<your response to the partner agent>",
  "nextAction": "ask_for_sample" | "infer_schema" | "propose_mapping" | "ask_for_webhook" | "provision" | "complete" | "wait",
  "extractedData": {
    "partnerName": "<if mentioned>",
    "partnerDomain": "<if mentioned>",
    "partnerEmail": "<if mentioned>",
    "webhookUrl": "<if provided>",
    "supportedFormats": ["json"|"xml"|"csv"|"edi-x12"|"edifact"],
    "samplePayload": "<raw payload string if provided>",
    "messageType": "ORDERS"|"INVOICES"|"SHIPMENTS"|"PAYMENTS"|"INVENTORY"|"ACKNOWLEDGMENTS"
  }
}`;

interface LLMDecision {
  message: string;
  nextAction: string;
  extractedData: {
    partnerName?: string;
    partnerDomain?: string;
    partnerEmail?: string;
    webhookUrl?: string;
    supportedFormats?: string[];
    samplePayload?: string;
    messageType?: string;
  };
}

export class NegotiationEngine {
  private store = new SessionStore();
  private provisioning = new ProvisioningClient();

  async handleUserMessage(session: AgentSession, userText: string): Promise<{ agentMessage: string; session: AgentSession }> {
    // Append user message to context
    const newMsg: NegotiationMessage = { role: 'user', content: userText, timestamp: new Date().toISOString() };
    const context = [...session.negotiationContext, newMsg];

    const llmCfg = await getPlatformLLM();
    if (!llmCfg) {
      const fallback = 'Thank you for your message. I am processing your request. Please provide your company name, contact email, the data format you use (JSON/XML/CSV/EDI), and a sample payload to begin schema inference.';
      const agentMsg: NegotiationMessage = { role: 'agent', content: fallback, timestamp: new Date().toISOString() };
      await this.store.update(session.id, { negotiationContext: [...context, agentMsg] });
      return { agentMessage: fallback, session: await this.store.findById(session.id) as AgentSession };
    }

    const client = buildLLMClient(llmCfg);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...context.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
    ];

    let decision: LLMDecision;
    try {
      const completion = await (client as OpenAI).chat.completions.create({
        model: llmCfg.model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
      decision = JSON.parse(completion.choices[0].message.content ?? '{}') as LLMDecision;
    } catch (err) {
      logger.error({ err }, 'LLM call failed during negotiation');
      decision = {
        message: 'I encountered an issue processing your request. Please resend your message.',
        nextAction: 'wait',
        extractedData: {},
      };
    }

    // Merge extracted data into session
    const patch: Partial<AgentSession> = {};
    const d = decision.extractedData ?? {};
    if (d.partnerName)    patch.partnerName    = d.partnerName;
    if (d.partnerDomain)  patch.partnerDomain  = d.partnerDomain;
    if (d.partnerEmail)   patch.partnerEmail   = d.partnerEmail;
    if (d.webhookUrl)     patch.webhookUrl     = d.webhookUrl;
    if (d.samplePayload)  patch.samplePayload  = d.samplePayload;
    if (d.supportedFormats?.length) patch.supportedFormats = d.supportedFormats;

    // Advance state machine
    if (decision.nextAction === 'infer_schema' && session.samplePayload || d.samplePayload) {
      patch.state = 'schema_submitted';
    } else if (decision.nextAction === 'propose_mapping') {
      patch.state = 'mapping_proposed';
    } else if (decision.nextAction === 'ask_for_webhook') {
      patch.state = 'terms_negotiated';
    } else if (decision.nextAction === 'provision' && (session.webhookUrl || d.webhookUrl)) {
      patch.state = 'provisioning';
    }

    const agentMsg: NegotiationMessage = {
      role: 'agent',
      content: decision.message,
      timestamp: new Date().toISOString(),
      metadata: { nextAction: decision.nextAction },
    };
    patch.negotiationContext = [...context, agentMsg];

    const updated = await this.store.update(session.id, patch);

    // If we should provision, kick off async provisioning
    if (patch.state === 'provisioning') {
      this.runProvisioning(updated).catch((err) =>
        logger.error({ err, sessionId: updated.id }, 'Provisioning failed'),
      );
    }

    return { agentMessage: decision.message, session: updated };
  }

  async runProvisioning(session: AgentSession): Promise<void> {
    logger.info({ sessionId: session.id }, 'Starting provisioning');
    try {
      // Register the partner
      const partnerName   = session.partnerName   ?? `Agent Partner ${session.id.slice(0, 8)}`;
      const partnerDomain = session.partnerDomain ?? `${session.id.slice(0, 8)}.agent-partner.local`;
      const partnerEmail  = session.partnerEmail  ?? `agent+${session.id.slice(0, 8)}@agent-partner.local`;
      const password      = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2).toUpperCase() + '!1';

      const { partnerId } = await this.provisioning.registerPartner({
        name: partnerName,
        domain: partnerDomain,
        contactEmail: partnerEmail,
        password,
        webhookUrl: session.webhookUrl,
        supportedFormats: session.supportedFormats.length ? session.supportedFormats : ['json'],
      });

      await this.store.update(session.id, {
        partnerId,
        state: 'active',
        completedAt: new Date(),
        negotiationContext: [
          ...session.negotiationContext,
          {
            role: 'agent',
            content: `✅ Integration provisioned successfully. Your partner ID is ${partnerId}. You can now send messages through the platform.`,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      logger.info({ sessionId: session.id, partnerId }, 'Provisioning complete');
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'Provisioning error');
      await this.store.update(session.id, {
        state: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Provisioning failed',
      });
    }
  }
}
