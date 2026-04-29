import { env } from './config/env';
import { createApp } from './app';
import { startDomainPoller } from './domain-poller';

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Express API listening on port ${env.PORT}`);
  startDomainPoller();
});