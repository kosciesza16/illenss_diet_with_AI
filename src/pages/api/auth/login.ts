import type { APIRoute } from 'astro';
import { supabaseClient } from '../../../db/supabase.client';

export const post: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'Invalid JSON body' } }), { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return new Response(JSON.stringify({ error: { code: 'validation', message: 'Email and password are required' } }), { status: 400 });
  }

  try {
    // Use Supabase client to sign in with password. This uses the anon key configured in supabase.client
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      // Map to general message for client
      return new Response(JSON.stringify({ error: { code: error.message || 'invalid_credentials', message: 'Nieprawidłowy email lub hasło' } }), { status: 401 });
    }

    const session = data?.session ?? null;
    const user = data?.user ?? null;

    return new Response(JSON.stringify({ userId: user?.id ?? null, session }), { status: 200 });
  } catch (e: any) {
    console.error('Login failed', e);
    return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error' } }), { status: 500 });
  }
};

