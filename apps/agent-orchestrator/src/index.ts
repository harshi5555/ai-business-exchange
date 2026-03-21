import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cron from 'node-cron';
import { createLogger } from '@bx/logger';
import { agentRoutes } from './routes/agents';
import { MonitorAgent } from './agents/monitorAgent';
import { RetryAgent } from './agents/retryAgent';
import { SchemaChangeAgent } from './agents/schemaChangeAgent';
import { AlertAgent } from './agents/alertAgent';
import { AGENT_DEFINITIONS, agentRuntimeRegistry } from './services/agentRuntimeRegistry';

const logger = createLogger('agent-orchestrator');
const app = express();
const PORT = process.env.PORT ?? 3006;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'agent-orchestrator' }));
app.use('/api/agents', agentRoutes);

// ─── Scheduled Agents ─────────────────────────────────────────────────────────
const monitorAgent = new MonitorAgent(logger);
const retryAgent = new RetryAgent(logger);
const schemaChangeAgent = new SchemaChangeAgent(logger);
const alertAgent = new AlertAgent(logger);

agentRuntimeRegistry.initialize(AGENT_DEFINITIONS);

// Monitor: every minute
cron.schedule('* * * * *', () => {
  void agentRuntimeRegistry.runTracked('monitor', () => monitorAgent.run());
});
// Retry failed deliveries: every 2 minutes
cron.schedule('*/2 * * * *', () => {
  void agentRuntimeRegistry.runTracked('retry', () => retryAgent.run());
});
// Schema drift check: every 30 minutes
cron.schedule('*/30 * * * *', () => {
  void agentRuntimeRegistry.runTracked('schema-change', () => schemaChangeAgent.run());
});
// Alert: every 5 minutes
cron.schedule('*/5 * * * *', () => {
  void agentRuntimeRegistry.runTracked('alert', () => alertAgent.run());
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Agent Orchestrator started'));

export default app;
