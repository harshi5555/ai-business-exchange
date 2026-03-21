// ─── Partner ──────────────────────────────────────────────────────────────────

export type PartnerStatus = 'pending' | 'approved' | 'suspended' | 'rejected' | 'archived';
export type MessageFormat = 'json' | 'xml' | 'csv' | 'edi-x12' | 'edifact';
export type MessageType = 'ORDERS' | 'INVOICES' | 'SHIPMENTS' | 'PRODUCTS' | 'PAYMENTS' | 'INVENTORY' | 'ACKNOWLEDGMENTS' | string;

export type LLMProvider = 'azure' | 'openai' | 'openai-compatible';

/** Per-partner LLM config passed to the mapping engine at request time. */
export interface PartnerLLMConfig {
  provider: LLMProvider;
  endpoint?: string;   // required for azure / openai-compatible
  model: string;
  apiKey: string;      // decrypted — only in-process, never serialised to API
}

export interface Partner {
  id: string;
  name: string;
  domain: string;
  contactEmail: string;
  status: PartnerStatus;
  webhookUrl?: string;
  supportedFormats: MessageFormat[];
  supportedMessageTypes: MessageType[];
  apiKeyHash?: string;
  /** true  → use the platform's configured LLM (default) */
  llmUsePlatform: boolean;
  llmProvider?: LLMProvider;
  llmEndpoint?: string;
  llmModel?: string;
  /** true if an encrypted API key is stored; the key itself is never returned */
  llmApiKeySet?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerDto {
  name: string;
  domain: string;
  contactEmail: string;
  webhookUrl?: string;
  supportedFormats: MessageFormat[];
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'requested'
  | 'approved'
  | 'active'
  | 'paused'
  | 'terminated';

export interface Subscription {
  id: string;
  subscriberPartnerId: string;
  providerPartnerId: string;
  status: SubscriptionStatus;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionDto {
  subscriberPartnerId: string;
  providerPartnerId: string;
}

// ─── Schema Registry ──────────────────────────────────────────────────────────

export type SchemaDirection = 'outbound' | 'inbound';

export interface SchemaRegistration {
  id: string;
  partnerId: string;
  format: MessageFormat;
  messageType: string;
  schemaDirection: SchemaDirection;
  createdWithModel?: string;
  samplePayload: string;
  inferredSchema: Record<string, unknown>;
  mappingRules: MappingRule[];
  version: number;
  status: string;
  isActive: boolean;
  createdAt: Date;
}

export interface MappingRule {
  sourceField: string;
  targetField: string;
  transform?: string;
  confidence: number;
}

// ─── Message ──────────────────────────────────────────────────────────────────

export type MessageStatus = 'received' | 'processing' | 'delivered' | 'failed' | 'dead_lettered';

export interface Message {
  id: string;
  sourcePartnerId: string;
  targetPartnerId: string;
  subscriptionId: string;
  format: MessageFormat;
  rawPayload: string;
  mappedPayload?: string;
  status: MessageStatus;
  retries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InboundMessageDto {
  targetPartnerId: string;
  format: MessageFormat;
  payload: string;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentType = 'monitor' | 'retry' | 'schema-change' | 'onboarding' | 'alert';

export interface AgentEvent {
  id: string;
  agentType: AgentType;
  entityId: string;
  action: string;
  outcome: 'success' | 'failure' | 'skipped';
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  partnerId: string;
  scopes: string[];
  iat: number;
  exp: number;
}

export type AuthScope =
  | 'partner:read'
  | 'partner:write'
  | 'integration:send'
  | 'integration:receive'
  | 'admin';
