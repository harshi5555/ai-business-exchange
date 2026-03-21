import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger } from '@bx/logger';
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';

const logger = createLogger('gateway');
const app = express();
const PORT = process.env.PORT ?? 3000;

// Security
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.set('trust proxy', 1);

app.use(requestLogger(logger));

// Health check (no auth)
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

// ─── Service Routes ───────────────────────────────────────────────────────────

const services: Record<string, string> = {
  '/api/auth':          process.env.AUTH_SERVICE_URL    ?? 'http://localhost:3001',
  '/api/partners':      process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002',
  '/api/subscriptions': process.env.SUBSCRIPTION_SERVICE_URL ?? 'http://localhost:3003',
  '/api/integrations':  process.env.INTEGRATION_SERVICE_URL  ?? 'http://localhost:3004',
  '/api/mappings':      process.env.MAPPING_ENGINE_URL   ?? 'http://localhost:3005',
  '/api/agents':        process.env.AGENT_ORCHESTRATOR_URL ?? 'http://localhost:3006',
  '/api/billing':       process.env.BILLING_SERVICE_URL  ?? 'http://localhost:3007',
};

const makeProxy = (target: string, prefix: string) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 120000,
    timeout: 120000,
    pathRewrite: (path: string) => `${prefix}${path === '/' ? '' : path}`,
  });

// Auth routes — no JWT required (login/register/token)
app.use('/api/auth', makeProxy(services['/api/auth'], '/api/auth'));

// Partner routes — some public, others require JWT
app.use('/api/partners', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') return next(); // self-registration
  if (req.method === 'GET' && req.path === '/platform-branding') return next(); // public branding
  return authMiddleware(req, res, next);
}, makeProxy(services['/api/partners'], '/api/partners'));
app.use('/api/subscriptions', authMiddleware, makeProxy(services['/api/subscriptions'], '/api/subscriptions'));
app.use('/api/integrations', authMiddleware, makeProxy(services['/api/integrations'], '/api/integrations'));
app.use('/api/mappings', authMiddleware, makeProxy(services['/api/mappings'], '/api/mappings'));
app.use('/api/agents', authMiddleware, makeProxy(services['/api/agents'], '/api/agents'));
app.use('/api/billing', authMiddleware, makeProxy(services['/api/billing'], '/api/billing'));

// 404 fallback
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

app.listen(PORT, () => {
  logger.info({ port: PORT, services }, 'API Gateway started');
});

export default app;
