import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { partnerRoutes } from './routes/partners';
import { adminRoutes } from './routes/admin';

const logger = createLogger('partner-service');
const app = express();
const PORT = process.env.PORT ?? 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'partner-service' }));

app.use('/api/partners', partnerRoutes);
app.use('/api/partners/admin', adminRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Partner Service started'));

export default app;
