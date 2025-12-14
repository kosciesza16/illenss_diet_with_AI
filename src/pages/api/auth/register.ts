import type { APIRoute } from 'astro';
import { supabaseClient } from '../../../db/supabase.client';

export const post: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'Invalid JSON body' } }), { status: 400 });
  }

  const { email, password, displayName } = body || {};
  if (!email || !password) {
    return new Response(JSON.stringify({ error: { code: 'validation', message: 'Email and password are required' } }), { status: 400 });
  }

  try {
    // Create user via Supabase auth signUp
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      // Map common messages to general client-friendly responses
      const message = /already registered/i.test(error.message) ? 'Konto o podanym adresie e-mail już istnieje' : 'Rejestracja nie powiodła się';
      const status = /already registered/i.test(error.message) ? 409 : 400;
      return new Response(JSON.stringify({ error: { code: error.message || 'signup_error', message } }), { status });
    }

    // Optionally create profile row using service role key or anon client (deferred to backend jobs)
    // Inform client that a confirmation email was sent (Supabase sends email if configured)
    return new Response(JSON.stringify({ message: 'Rejestracja zakończona. Sprawdź swoją skrzynkę pocztową, aby potwierdzić konto.' }), { status: 201 });
  } catch (e: any) {
    console.error('Register failed', e);
    return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error' } }), { status: 500 });
  }
};

