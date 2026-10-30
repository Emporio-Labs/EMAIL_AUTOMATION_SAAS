import { env } from './config/env';
import { createApp } from './app';
import { startDomainPoller } from './domain-poller';
import { startHtmlPurger } from './html-purger';
import { startWebhookDispatcher } from './lib/webhooks';

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Express API listening on port ${env.PORT}`);
  if (env.RUN_BACKGROUND_JOBS) {
    startDomainPoller();
    startHtmlPurger();
    startWebhookDispatcher();
  }
});