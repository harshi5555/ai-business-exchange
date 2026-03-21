import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { seedAdmin } from '@bx/database';
import { authRoutes } from './routes/auth';
import { apiKeyRoutes } from './routes/apiKeys';

const logger = createLogger('auth-service');
const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }));

app.use('/api/auth', authRoutes);
app.use('/api/auth/keys', apiKeyRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, async () => {
  await seedAdmin().catch(err => logger.error({ err }, 'Admin seed failed'));
  logger.info({ port: PORT }, 'Auth Service started');
});

export default app;
