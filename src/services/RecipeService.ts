import { supabaseClient } from '../db/supabase.client';
import type { CreateRecipeCommand, RecipeResponseDTO, IngredientRow } from '../types';

import { v4 as uuidv4 } from 'uuid';

export class RecipeService {
  /**
   * Create a recipe and its ingredients. This implementation performs multiple
   * DB operations. Ideally, use a Postgres transaction; if not available through the SDK,
   * we attempt best-effort cleanup on failure.
   */
  static async createRecipe(userId: string, cmd: CreateRecipeCommand): Promise<RecipeResponseDTO> {
    // Create recipe id
    const recipeId = uuidv4();

    // Insert recipe row
    const { data: recipeData, error: recipeError } = await supabaseClient
      .from('recipes')
      .insert([
        {
          id: recipeId,
          owner_user_id: userId,
          title: cmd.title,
          raw_text: cmd.raw_text,
          recipe_data: cmd.recipe_data,
        },
      ])
      .select('*')
      .single();

    if (recipeError || !recipeData) {
      throw new Error(`Failed to insert recipe: ${recipeError?.message || 'unknown'}`);
    }

    // Bulk insert ingredients
    const ingredientsPayload = cmd.recipe_data.ingredients.map((ing) => ({
      id: uuidv4(),
      name: ing.name,
      normalized_name: ing.normalized_name ?? null,
      quantity: ing.quantity,
      recipe_id: recipeId,
      unit_id: ing.unit_id ?? null,
      unit_text: ing.unit_text ?? null,
    }));

    const { data: ingredientsData, error: ingredientsError } = await supabaseClient
      .from('ingredients')
      .insert(ingredientsPayload)
      .select('*');

    if (ingredientsError) {
      // attempt cleanup: delete recipe
      await supabaseClient.from('recipes').delete().eq('id', recipeId);
      throw new Error(`Failed to insert ingredients: ${ingredientsError.message}`);
    }

    const ingredients = (ingredientsData as IngredientRow[]) || [];

    // Insert audit row
    try {
      await supabaseClient.from('recipe_audit').insert([
        {
          action: 'create',
          anonymized_id: null,
          recipe_id: recipeId,
          user_id: userId,
          meta: { title: cmd.title },
        },
      ]);
    } catch (e) {
      // non-blocking: log and continue
      console.error('Failed to write audit row', e);
    }

    // Assemble response (cached_nutrition left as null for now)
    const response: RecipeResponseDTO = {
      ...recipeData,
      recipe_data: cmd.recipe_data,
      ingredients,
      cached_nutrition: null,
    } as unknown as RecipeResponseDTO;

    return response;
  }
}

