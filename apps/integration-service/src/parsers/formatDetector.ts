import { MessageFormat } from '@bx/shared-types';

export class FormatDetector {
  static detect(contentType: string, body: string | object): MessageFormat {
    const ct = contentType.toLowerCase();
    if (ct.includes('xml')) return 'xml';
    if (ct.includes('csv') || ct.includes('text/plain')) return 'csv';
    if (ct.includes('edi') || (typeof body === 'string' && body.startsWith('ISA'))) return 'edi-x12';
    if (typeof body === 'string' && (body.startsWith('UNB') || body.startsWith('UNA'))) return 'edifact';
    return 'json';
  }
}
