import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@bx/logger';
import { mappingRoutes } from './routes/mappings';
import { schemaRoutes } from './routes/schemas';

const logger = createLogger('mapping-engine');
const app = express();
const PORT = process.env.PORT ?? 3005;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mapping-engine' }));
app.use('/api/mappings/schemas', schemaRoutes);
app.use('/api/mappings', mappingRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'Mapping Engine started'));

export default app;
