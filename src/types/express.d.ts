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
      };
    }
  }
}

export {};