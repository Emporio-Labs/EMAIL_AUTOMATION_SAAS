import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { fromBase64Url } from '../lib/tracker';

export const trackingRouter = Router();

const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_BUFFER = Buffer.from(GIF_BASE64, 'base64');

// GET /t/o/:jobId — Open tracking pixel
trackingRouter.get('/o/:jobId', async (request, response) => {
  const jobId = request.params.jobId;

  // Render transparent pixel response immediately to keep email client happy
  response.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': GIF_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  });
  response.end(GIF_BUFFER);

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

// GET /t/c/:jobId/:encodedUrl — Link click tracking redirector
trackingRouter.get('/c/:jobId/:encodedUrl', async (request, response) => {
  const { jobId, encodedUrl } = request.params;
  let decodedUrl = '';

  try {
    decodedUrl = fromBase64Url(encodedUrl);
  } catch (err) {
    console.error('[tracking/click] Failed to decode URL:', encodedUrl, err);
    response.status(400).send('Invalid tracking URL');
    return;
  }

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

  // Always redirect to the destination URL
  response.redirect(302, decodedUrl);
});
