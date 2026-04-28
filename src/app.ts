import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { TEST_TENANT, TEST_USER } from './config/test-context';
import { authRouter } from './routes/auth';
import { contactsRouter } from './routes/contacts';
import { healthRouter } from './routes/health';
import { listsRouter } from './routes/lists';
import { sendRouter } from './routes/send';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  // Testing-only context: keep the API usable without bearer auth or tenant membership.
  app.use((request, _response, next) => {
    const testRequest = request as any;

    testRequest.authUser = testRequest.authUser ?? {
      id: TEST_USER.id,
      email: TEST_USER.email,
    };

    testRequest.tenant = testRequest.tenant ?? {
      id: TEST_TENANT.id,
      name: TEST_TENANT.name,
      slug: TEST_TENANT.slug,
      role: TEST_TENANT.role,
    };

    next();
  });

  app.use('/health', healthRouter);
  app.use('/v1/auth', authRouter);
  app.use('/v1/lists', listsRouter);
  app.use('/v1/contacts', contactsRouter);
  app.use('/v1/send', sendRouter);

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