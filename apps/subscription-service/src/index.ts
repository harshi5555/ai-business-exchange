import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { subscriptionRoutes } from './routes/subscriptions';

const logger = createLogger('subscription-service');
const app = express();
const PORT = process.env.PORT ?? 3003;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'subscription-service' }));
app.use('/api/subscriptions', subscriptionRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Subscription Service started'));

export default app;
