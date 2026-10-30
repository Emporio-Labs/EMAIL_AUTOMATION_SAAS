import { createApp } from '../src/app';

// Vercel serverless: default-export the Express app (no app.listen).
// Background jobs (domain poller, HTML purge) do NOT run here; for production,
// run `npm start` on a long-lived server instead (see DEPLOY.md).
export default createApp();
