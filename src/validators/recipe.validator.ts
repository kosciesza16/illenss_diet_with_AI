import type { CreateRecipeCommand, RecipeDataIngredientDTO } from '../types';

export type ValidationResult = { valid: true } | { valid: false; errors: Record<string, string> };

function isUuid(value: any): boolean {
  return typeof value === 'string' && /^[0-9a-fA-F-]{36}$/.test(value);
}

export function validateIngredient(item: any, index: number): string | null {
  if (typeof item !== 'object' || item === null) return `ingredients[${index}] must be an object`;
  if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) return `ingredients[${index}].name is required`;
  if (item.name.length > 200) return `ingredients[${index}].name too long`;
  if (typeof item.quantity !== 'number' || isNaN(item.quantity) || item.quantity <= 0) return `ingredients[${index}].quantity must be a number > 0`;
  if (item.unit_id && !isUuid(item.unit_id)) return `ingredients[${index}].unit_id must be a valid UUID`;
  if (item.unit_text && typeof item.unit_text !== 'string') return `ingredients[${index}].unit_text must be a string`;
  if (item.normalized_name && typeof item.normalized_name !== 'string') return `ingredients[${index}].normalized_name must be a string`;
  return null;
}

export function validateCreateRecipeCommand(body: any): ValidationResult {
  const errors: Record<string, string> = {};

  if (!body || typeof body !== 'object') return { valid: false, errors: { body: 'Request body must be a JSON object' } };

  const { title, raw_text, recipe_data } = body as CreateRecipeCommand;

  if (!title || typeof title !== 'string' || title.trim().length === 0) errors.title = 'title is required';
  else if (title.length > 300) errors.title = 'title too long (max 300)';

  if (!raw_text || typeof raw_text !== 'string' || raw_text.trim().length === 0) errors.raw_text = 'raw_text is required';

  if (!recipe_data || typeof recipe_data !== 'object') {
    errors.recipe_data = 'recipe_data is required and must be an object';
  } else {
    if (!recipe_data.title || typeof recipe_data.title !== 'string' || recipe_data.title.trim().length === 0) errors['recipe_data.title'] = 'recipe_data.title required';

    if (!Array.isArray(recipe_data.ingredients) || recipe_data.ingredients.length === 0) errors['recipe_data.ingredients'] = 'ingredients must be a non-empty array';
    else {
      recipe_data.ingredients.forEach((ing: any, idx: number) => {
        const e = validateIngredient(ing, idx);
        if (e) errors[`recipe_data.ingredients[${idx}]`] = e;
      });
    }

    if (!Array.isArray(recipe_data.steps)) errors['recipe_data.steps'] = 'steps must be an array of strings';
    else {
      recipe_data.steps.forEach((s: any, idx: number) => {
        if (typeof s !== 'string') errors[`recipe_data.steps[${idx}]`] = 'step must be a string';
        else if (s.length < 10) errors[`recipe_data.steps[${idx}]`] = 'step too short (min 10 chars)';
        else if (s.length > 500) errors[`recipe_data.steps[${idx}]`] = 'step too long (max 500 chars)';
      });
    }
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true };
}

