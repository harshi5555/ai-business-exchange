import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { integrationRoutes } from './routes/integrations';

const logger = createLogger('integration-service');
const app = express();
const PORT = process.env.PORT ?? 3004;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['application/xml', 'text/csv', 'text/plain'], limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'integration-service' }));
app.use('/api/integrations', integrationRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Integration Service started'));

export default app;
