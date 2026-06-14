import { supabaseAdmin } from './lib/supabase';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Runs the database function to purge email HTML content older than 30 days.
 * This is executed as a background worker task.
 */
export async function purgeOldHtmlContents(): Promise<void> {
  console.log('[html-purger] Running HTML purge job...');
  try {
    const { error } = await supabaseAdmin.rpc('purge_old_html_contents');
    if (error) {
      console.error('[html-purger] Error calling purge_old_html_contents RPC:', error.message);
    } else {
      console.log('[html-purger] ✅ HTML purge job completed successfully.');
    }
  } catch (err) {
    console.error('[html-purger] Exception running HTML purge job:', err);
  }
}

/**
 * Starts the background loop to purge old HTML contents.
 * Called once on application startup.
 */
export function startHtmlPurger(): void {
  // Run once immediately on startup
  purgeOldHtmlContents();

  // Then schedule to run every 24 hours
  setInterval(purgeOldHtmlContents, PURGE_INTERVAL_MS);

  console.log('[html-purger] Started — running purge job every 24 hours.');
}
