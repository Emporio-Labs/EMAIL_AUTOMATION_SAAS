import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { env } from '../config/env';
import { fromBase64Url, verifyClickUrl } from '../lib/tracker';

export const trackingRouter = Router();

const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_BUFFER = Buffer.from(GIF_BASE64, 'base64');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /t/o/:jobId — Open tracking pixel
trackingRouter.get('/o/:jobId', async (request, response) => {
  const jobId = request.params.jobId;
  const validJobId = UUID_PATTERN.test(jobId);

  // Render transparent pixel response immediately to keep email client happy
  response.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': GIF_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  });
  response.end(GIF_BUFFER);

  if (!validJobId) return;

  // Perform DB actions asynchronously after response ends
  try {
    const { data: job, error } = await supabaseAdmin
      .from('email_jobs')
      .select('job_id, tenant_id, opened_at, open_count')
      .eq('job_id', jobId)
      .maybeSingle();

    if (error || !job) {
      console.warn('[tracking/open] Job not found or lookup error:', jobId, error);
      return;
    }

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      open_count: (job.open_count || 0) + 1,
    };
    if (!job.opened_at) {
      updatePayload.opened_at = now;
    }

    await supabaseAdmin
      .from('email_jobs')
      .update(updatePayload)
      .eq('job_id', jobId);

    await supabaseAdmin
      .from('email_job_events')
      .insert({
        job_id: jobId,
        tenant_id: job.tenant_id,
        event_type: 'opened',
        metadata: { ip: request.ip },
      });

  } catch (err) {
    console.error('[tracking/open] Error tracking open:', err);
  }
});

// GET /t/c/:jobId/:encodedUrl/:signature — Link click tracking redirector.
// Links sent before signing was added have no signature; those still redirect,
// but only when the job exists, so random URLs cannot be bounced through us.
trackingRouter.get(['/c/:jobId/:encodedUrl', '/c/:jobId/:encodedUrl/:signature'], async (request, response) => {
  const { jobId, encodedUrl } = request.params as { jobId: string; encodedUrl: string };
  const signature = (request.params as { signature?: string }).signature;
  let decodedUrl = '';

  try {
    decodedUrl = fromBase64Url(encodedUrl);
  } catch (err) {
    console.error('[tracking/click] Failed to decode URL:', encodedUrl, err);
    response.status(400).send('Invalid tracking URL');
    return;
  }

  if (!UUID_PATTERN.test(jobId) || !/^https?:\/\//i.test(decodedUrl)) {
    response.status(400).send('Invalid tracking URL');
    return;
  }

  if (signature !== undefined && !verifyClickUrl(jobId, decodedUrl, signature, env.INTERNAL_KEY)) {
    response.status(400).send('Invalid tracking URL');
    return;
  }

  let jobFound = false;

  // Process tracking details
  try {
    const { data: job, error } = await supabaseAdmin
      .from('email_jobs')
      .select('job_id, tenant_id, clicked_at, click_count')
      .eq('job_id', jobId)
      .maybeSingle();

    if (error || !job) {
      console.warn('[tracking/click] Job not found or lookup error:', jobId, error);
    } else {
      jobFound = true;
      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        click_count: (job.click_count || 0) + 1,
      };
      if (!job.clicked_at) {
        updatePayload.clicked_at = now;
      }

      await supabaseAdmin
        .from('email_jobs')
        .update(updatePayload)
        .eq('job_id', jobId);

      await supabaseAdmin
        .from('email_job_events')
        .insert({
          job_id: jobId,
          tenant_id: job.tenant_id,
          event_type: 'clicked',
          metadata: {
            url: decodedUrl,
            ip: request.ip,
            user_agent: request.headers['user-agent'] || null,
          },
        });
    }
  } catch (err) {
    console.error('[tracking/click] Error tracking click:', err);
  }

  if (signature === undefined && !jobFound) {
    response.status(404).send('Link not found');
    return;
  }

  response.redirect(302, decodedUrl);
});
