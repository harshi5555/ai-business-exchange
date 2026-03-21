import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { billingRoutes } from './routes/billing';

const logger = createLogger('billing-service');
const app = express();
const PORT = process.env.PORT ?? 3007;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'billing-service' }));
app.use('/api/billing', billingRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Billing Service started'));
export default app;
