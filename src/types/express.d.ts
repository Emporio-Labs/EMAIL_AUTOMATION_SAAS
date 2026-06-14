import type { User } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      tenant?: {
        id: string;
        name: string;
        slug: string | null;
        role: string;
        plan?: string;
        rateLimit?: number;
        monthlyEmailLimit?: number;
        monthlyEmailCount?: number;
        isSuspended?: boolean;
        max_domains?: number | null;
        max_sending_addresses?: number | null;
        max_recipients_per_send?: number | null;
        can_send_marketing?: boolean | null;
        can_use_webhooks?: boolean | null;
        can_track_opens?: boolean | null;
        can_track_clicks?: boolean | null;
        force_sandbox?: boolean | null;
        trial_ends_at?: string | null;
        internal_notes?: string | null;
      };
      apiKey?: {
        id: string;
        tenantId: string;
        name: string;
        type: 'sandbox' | 'production';
        keyPreview: string;
      };
      keyType?: 'sandbox' | 'production';
    }
  }
}

export {};