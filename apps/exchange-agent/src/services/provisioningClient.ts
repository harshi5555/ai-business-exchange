import axios from 'axios';
import { createLogger } from '@bx/logger';

const logger = createLogger('exchange-agent:provisioning');

const PARTNER_SERVICE_URL       = process.env.PARTNER_SERVICE_URL       ?? 'http://localhost:3002';
const MAPPING_ENGINE_URL        = process.env.MAPPING_ENGINE_URL        ?? 'http://localhost:3005';
const SUBSCRIPTION_SERVICE_URL  = process.env.SUBSCRIPTION_SERVICE_URL ?? 'http://localhost:3003';

export interface RegisterPartnerInput {
  name: string;
  domain: string;
  contactEmail: string;
  password: string;
  webhookUrl?: string;
  supportedFormats: string[];
}

export interface RegisterPartnerResult {
  partnerId: string;
  apiKey?: string;
}

export interface SchemaInferenceInput {
  partnerId: string;
  samplePayload: string;
  format: string;
  messageType: string;
  direction: 'outbound' | 'inbound';
  internalAuthToken: string;
}

export interface SchemaInferenceResult {
  schemaId: string;
  mappingRules: Array<{ sourceField: string; targetField: string; confidence: number }>;
  autoApproved: boolean;
}

export interface SubscriptionInput {
  subscriberPartnerId: string;
  providerPartnerId: string;
  internalAuthToken: string;
}

export interface SubscriptionResult {
  subscriptionId: string;
  status: string;
}

export class ProvisioningClient {
  async registerPartner(input: RegisterPartnerInput): Promise<RegisterPartnerResult> {
    logger.info({ domain: input.domain }, 'Registering partner via partner-service');
    const res = await axios.post<{ success: boolean; data: { partner: { id: string }; apiKey?: string } }>(
      `${PARTNER_SERVICE_URL}/api/partners`,
      {
        name: input.name,
        domain: input.domain,
        contactEmail: input.contactEmail,
        password: input.password,
        webhookUrl: input.webhookUrl,
        supportedFormats: input.supportedFormats,
      },
      { timeout: 15000 },
    );
    if (!res.data.success) throw new Error('Partner registration failed');
    return {
      partnerId: res.data.data.partner.id,
      apiKey: res.data.data.apiKey,
    };
  }

  async inferSchema(input: SchemaInferenceInput): Promise<SchemaInferenceResult> {
    logger.info({ partnerId: input.partnerId }, 'Inferring schema via mapping-engine');
    const res = await axios.post<{
      success: boolean;
      data: { id: string; mappingRules: SchemaInferenceResult['mappingRules']; autoApproved: boolean };
    }>(
      `${MAPPING_ENGINE_URL}/api/mappings/schemas/register`,
      {
        partnerId: input.partnerId,
        format: input.format,
        messageType: input.messageType,
        schemaDirection: input.direction,
        samplePayload: input.samplePayload,
      },
      {
        headers: { Authorization: `Bearer ${input.internalAuthToken}` },
        timeout: 60000,
      },
    );
    if (!res.data.success) throw new Error('Schema inference failed');
    return {
      schemaId: res.data.data.id,
      mappingRules: res.data.data.mappingRules,
      autoApproved: res.data.data.autoApproved,
    };
  }

  async listAvailableSubscriptions(internalAuthToken: string): Promise<Array<{ id: string; providerPartnerId: string; providerName?: string }>> {
    const res = await axios.get<{ success: boolean; data: Array<{ id: string; provider_partner_id: string; provider_name?: string }> }>(
      `${SUBSCRIPTION_SERVICE_URL}/api/subscriptions/available`,
      {
        headers: { Authorization: `Bearer ${internalAuthToken}` },
        timeout: 10000,
      },
    );
    if (!res.data.success) return [];
    return res.data.data.map((s) => ({
      id: s.id,
      providerPartnerId: s.provider_partner_id,
      providerName: s.provider_name,
    }));
  }

  async createSubscription(input: SubscriptionInput): Promise<SubscriptionResult> {
    const res = await axios.post<{ success: boolean; data: { id: string; status: string } }>(
      `${SUBSCRIPTION_SERVICE_URL}/api/subscriptions`,
      {
        subscriberPartnerId: input.subscriberPartnerId,
        providerPartnerId: input.providerPartnerId,
      },
      {
        headers: { Authorization: `Bearer ${input.internalAuthToken}` },
        timeout: 10000,
      },
    );
    if (!res.data.success) throw new Error('Subscription creation failed');
    return { subscriptionId: res.data.data.id, status: res.data.data.status };
  }
}
