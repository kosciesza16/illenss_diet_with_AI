import type { APIRoute } from 'astro';
import { validateCreateRecipeCommand } from '../../../../validators/recipe.validator';
import { RecipeService } from '../../../../services/RecipeService';
import { supabaseClient } from '../../../../db/supabase.client';

// Helper to extract token and validate using Supabase
async function getAuthUserIdFromHeader(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];

  // Verify token using Supabase client
  try {
    const { data, error } = await supabaseClient.auth.getUser(token as any);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch (e) {
    console.error('Auth verify failed', e);
    return null;
  }
}

export const post: APIRoute = async ({ request }) => {
  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'Invalid JSON body' } }), { status: 400 });
  }

  // Validate
  const validation = validateCreateRecipeCommand(body);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'Validation failed', details: validation.errors } }), { status: 400 });
  }

  // Authenticate
  const authUserId = await getAuthUserIdFromHeader(request);
  if (!authUserId) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Missing or invalid token' } }), { status: 401 });

  // Map auth uid to internal user_id via auth_user_map table
  let userId: string | null = null;
  try {
    const { data: mapping } = await supabaseClient.from('auth_user_map').select('*').eq('auth_user_id', authUserId).limit(1).single();
    if (mapping && mapping.user_id) userId = mapping.user_id;
    else {
      // Create a new internal user row and mapping
      const { data: newUser } = await supabaseClient.from('users').insert([{ user_id: authUserId, age: 0, disease: '', preferences: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), sex: '' }]).select('*').single();
      userId = newUser.user_id;
      await supabaseClient.from('auth_user_map').insert([{ auth_user_id: authUserId, user_id: userId }]);
    }
  } catch (e) {
    console.error('Failed to resolve/create user mapping', e);
    return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Failed to resolve user' } }), { status: 500 });
  }

  // Create recipe
  try {
    const recipe = await RecipeService.createRecipe(userId, body);
    return new Response(JSON.stringify(recipe), { status: 201 });
  } catch (e: any) {
    console.error('Create recipe failed', e);
    return new Response(JSON.stringify({ error: { code: 'internal_error', message: e.message || 'internal' } }), { status: 500 });
  }
};

