import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard early: fail-fast with a clear message if env is not configured.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase client requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables to be set.'
  );
}

export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);

