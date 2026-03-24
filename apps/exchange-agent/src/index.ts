import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { agentCardRouter } from './routes/agentCard';
import { a2aTasksRouter } from './routes/a2aTasks';
import { mcpRouter } from './routes/mcp';

const logger = createLogger('exchange-agent');
const app = express();
const PORT = process.env.PORT ?? 3008;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'exchange-agent' }));

// A2A Agent Card — public, no auth
app.use('/.well-known', agentCardRouter);

// A2A task endpoints — require x-api-key (handled inside router)
app.use('/a2a', a2aTasksRouter);

// MCP endpoint — require x-api-key (handled inside router)
app.use('/mcp', mcpRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Exchange Agent started'));

export default app;
