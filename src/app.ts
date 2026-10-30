import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/auth';
import { analyticsRouter } from './routes/analytics';
import { contactsRouter } from './routes/contacts';
import { campaignsRouter } from './routes/campaigns';
import { domainsRouter } from './routes/domains';
import { healthRouter } from './routes/health';
import { internalRouter } from './routes/internal';
import { listsRouter } from './routes/lists';
import { apiKeysRouter } from './routes/api-keys';
import { sendsRouter } from './routes/sends';
import { sendRouter } from './routes/send';
import { unsubscribeRouter } from './routes/unsubscribe';
import { sendingAddressesRouter } from './routes/sending-addresses';
import { adminRouter } from './routes/admin';
import { trackingRouter } from './routes/tracking';

export function createApp() {
  const app = express();

  // Behind Caddy/nginx on EC2: use X-Forwarded-For for request.ip.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());
  // Parse JSON routes normally, then accept raw text only for SNS webhooks.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/plain' }));
  app.use(morgan('dev'));

  app.use('/health', healthRouter);
  app.use('/v1/auth', authRouter);
  app.use('/v1/analytics', analyticsRouter);
  app.use('/v1/campaigns', campaignsRouter);
  app.use('/v1/sends', sendsRouter);
  app.use('/v1/domains', domainsRouter);
  app.use('/v1/sending-addresses', sendingAddressesRouter);
  app.use('/v1/lists', listsRouter);
  app.use('/v1/contacts', contactsRouter);
  app.use('/v1/api-keys', apiKeysRouter);
  app.use('/v1/send', sendRouter);
  app.use('/v1/unsubscribe', unsubscribeRouter);
  app.use('/v1/admin', adminRouter);
  app.use('/t', trackingRouter);
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