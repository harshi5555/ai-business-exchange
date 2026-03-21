import axios from 'axios';
import { signPayload, backoffDelay, sleep } from '@bx/shared-utils';
import { MessageFormat } from '@bx/shared-types';

interface DeliverInput {
  messageId: string;
  webhookUrl: string;
  payload: string;
  format: MessageFormat;        // original source format (for metadata)
  deliveryFormat: MessageFormat; // actual format of the payload being sent
  sourcePartnerId: string;
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'changeme';
const MAX_RETRIES = 3;

const CONTENT_TYPE_MAP: Record<MessageFormat, string> = {
  'json': 'application/json',
  'xml': 'application/xml',
  'csv': 'text/csv',
  'edi-x12': 'application/edi-x12',
  'edifact': 'application/edifact',
};

export class WebhookDelivery {
  async deliver(input: DeliverInput): Promise<{ delivered: boolean; errorMessage?: string }> {
    const signature = signPayload(input.payload, WEBHOOK_SECRET);
    let lastError = '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt - 1));
      }
      try {
        const res = await axios.post(input.webhookUrl, input.payload, {
          headers: {
            'Content-Type': CONTENT_TYPE_MAP[input.deliveryFormat] ?? 'application/octet-stream',
            'X-BX-Message-Id': input.messageId,
            'X-BX-Source-Partner': input.sourcePartnerId,
            'X-BX-Signature': `sha256=${signature}`,
            'X-BX-Timestamp': new Date().toISOString(),
          },
          timeout: 10000,
        });
        if (res.status >= 200 && res.status < 300) return { delivered: true };
        lastError = `Webhook returned HTTP ${res.status}`;
      } catch (err) {
        if (axios.isAxiosError(err)) {
          lastError = err.response
            ? `HTTP ${err.response.status}: ${typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data ?? {})}`.slice(0, 300)
            : `Connection error: ${err.message}`;
        } else {
          lastError = err instanceof Error ? err.message : 'Unknown error';
        }
      }
    }
    return { delivered: false, errorMessage: `After ${MAX_RETRIES + 1} attempts: ${lastError}` };
  }
}
