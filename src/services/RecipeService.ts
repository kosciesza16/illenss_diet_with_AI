import { supabaseClient } from '../db/supabase.client';
import type { CreateRecipeCommand, RecipeResponseDTO, IngredientRow } from '../types';
import OpenRouterService, { OpenRouterMessage, ResponseFormatSpec } from './OpenRouterService';

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

    // Attempt to enrich ingredients with nutrition via OpenRouter LLM (non-blocking)
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (apiKey) {
        const llm = new OpenRouterService({ apiKey, logger: console });

        // Optional: set a helpful system message
        llm.setSystemMessage(
          'You are a nutrition analysis assistant. Given a list of ingredients with quantities, return a JSON object mapping each ingredient id to approximate nutrition values per the provided quantity. Be concise and return only JSON matching the schema provided.'
        );

        // Build user message containing ingredient details
        const ingredientLines = ingredients.map((ing) => {
          const qty = ing.quantity ?? '';
          const unit = ing.unit_text ?? ing.unit_id ?? '';
          return `${ing.id} | ${ing.name} | quantity: ${qty} ${unit}`;
        });

        const userMessage: OpenRouterMessage = {
          role: 'user',
          content: `Dla poniższych składników podaj przybliżone wartości odżywcze odpowiadające podanej ilości (per item string):\n${ingredientLines.join('\n')}`,
        };

        // send only the user message; OpenRouterService will prepend the systemMessage if set
        const messages: OpenRouterMessage[] = [userMessage];

        // Define response_format schema
        const responseFormat: ResponseFormatSpec = {
          type: 'json_schema',
          json_schema: {
            name: 'ingredient_nutrition_list',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                ingredients: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      nutrition: {
                        type: 'object',
                        properties: {
                          calories: { type: 'number' },
                          protein_g: { type: 'number' },
                          fat_g: { type: 'number' },
                          carbs_g: { type: 'number' }
                        },
                        required: ['calories', 'protein_g', 'fat_g', 'carbs_g']
                      },
                      warnings: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['id', 'name', 'nutrition']
                  }
                }
              },
              required: ['ingredients']
            }
          }
        };

        const llmResult = await llm.sendStructuredMessage<Record<string, any>>(messages, responseFormat);

        // llmResult expected shape: { ingredients: [{ id, name, nutrition, warnings? }, ...] }
        if (llmResult && Array.isArray(llmResult.ingredients)) {
          const nutritionMap: Record<string, any> = {};
          for (const item of llmResult.ingredients) {
            if (item && item.id) {
              nutritionMap[item.id] = item.nutrition ?? null;
            }
          }

          // Persist as cached_nutrition on recipe row (best-effort)
          try {
            await supabaseClient.from('recipes').update({ cached_nutrition: nutritionMap }).eq('id', recipeId);
          } catch (e) {
            console.error('Failed to persist cached_nutrition', e);
          }
        }
      } else {
        console.debug('OPENROUTER_API_KEY not set — skipping nutrition enrichment');
      }
    } catch (e) {
      // Non-blocking: log and continue
      console.error('Nutrition enrichment failed', e);
    }

    // Assemble response (cached_nutrition left as null for now or updated above)
    const response: RecipeResponseDTO = {
      ...recipeData,
      recipe_data: cmd.recipe_data,
      ingredients,
      cached_nutrition: null,
    } as unknown as RecipeResponseDTO;

    return response;
  }
}
