import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/auth';
import { analyticsRouter } from './routes/analytics';
import { contactsRouter } from './routes/contacts';
import { domainsRouter } from './routes/domains';
import { healthRouter } from './routes/health';
import { internalRouter } from './routes/internal';
import { listsRouter } from './routes/lists';
import { apiKeysRouter } from './routes/api-keys';
import { sendsRouter } from './routes/sends';
import { sendRouter } from './routes/send';
import { sendingAddressesRouter } from './routes/sending-addresses';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.use('/health', healthRouter);
  app.use('/v1/auth', authRouter);
  app.use('/v1/analytics', analyticsRouter);
  app.use('/v1/sends', sendsRouter);
  app.use('/v1/domains', domainsRouter);
  app.use('/v1/sending-addresses', sendingAddressesRouter);
  app.use('/v1/lists', listsRouter);
  app.use('/v1/contacts', contactsRouter);
  app.use('/v1/api-keys', apiKeysRouter);
  app.use('/v1/send', sendRouter);
  app.use('/internal', internalRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof Error) {
      response.status(500).json({ error: error.message });
      return;
    }

    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}