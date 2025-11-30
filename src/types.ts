import type { Json, Database } from './db/database.types';

// Re-export some low-level row/insert types from the generated DB types for clarity
export type RecipeRow = Database['public']['Tables']['recipes']['Row'];
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert'];
export type IngredientRow = Database['public']['Tables']['ingredients']['Row'];
export type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
export type UserRow = Database['public']['Tables']['users']['Row'];
export type IngredientNutrientRow = Database['public']['Tables']['ingredient_nutrients']['Row'];
export type AIJobRow = Database['public']['Tables']['ai_jobs']['Row'];
export type RecipeAuditRow = Database['public']['Tables']['recipe_audit']['Row'];
export type UnitRow = Database['public']['Tables']['units']['Row'];
export type AuthUserMapRow = Database['public']['Tables']['auth_user_map']['Row'];

// ----------------------------
// Profile DTOs / Commands
// ----------------------------

// Response DTO for a user's profile (direct mapping to DB row fields used by API responses)
export type ProfileResponseDTO = Pick<
  UserRow,
  'user_id' | 'disease' | 'age' | 'sex' | 'allergies' | 'preferences' | 'created_at' | 'updated_at'
>;

// Command used by API to create or update a profile. We keep it narrow and explicit
// rather than depending on DB Insert type to allow validation rules (e.g. disease enum) at API layer.
export type ProfileCreateCommand = {
  disease: UserRow['disease']; // string in DB; API layer should validate against allowed enum
  age: UserRow['age'];
  sex: UserRow['sex'];
  allergies?: UserRow['allergies'];
  preferences?: UserRow['preferences'];
};

export type ProfileUpdateCommand = Partial<ProfileCreateCommand>;

// ----------------------------
// Recipe DTOs / Commands
// ----------------------------

// Ingredient shape used inside recipe payloads (API-level DTO)
export type RecipeDataIngredientDTO = {
  name: string;
  quantity: number;
  unit_id?: string | null;
  unit_text?: string | null;
  normalized_name?: string;
};

// Structured recipe_data expected by API clients (the DB stores this as Json)
export type RecipeDataDTO = {
  title: string;
  ingredients: RecipeDataIngredientDTO[];
  steps: string[];
};

// Command to create a recipe. Mirrors required fields from DB Insert but uses structured DTO for recipe_data
export type CreateRecipeCommand = {
  title: string;
  raw_text: string;
  recipe_data: RecipeDataDTO;
};

// Partial update command (PATCH)
export type PatchRecipeCommand = Partial<CreateRecipeCommand>;

// Response DTO sent by API for a recipe. We base this on the DB Row but replace the opaque Json with typed DTOs
export type RecipeResponseDTO = Omit<
  RecipeRow,
  'recipe_data' | 'tsv' | 'cached_nutrition'
> & {
  recipe_data: RecipeDataDTO;
  ingredients: IngredientRow[]; // normalized ingredient rows for this recipe
  cached_nutrition: Json | null; // keep DB type but documented as nutrition summary
  computed_nutrition?: Json | null; // computed by API using profile + nutrition reference
};

// Lightweight summary used in list endpoints
export type RecipeListItemDTO = Pick<
  RecipeRow,
  'id' | 'title' | 'owner_user_id' | 'created_at' | 'updated_at' | 'deleted_at'
> & {
  cached_nutrition?: Json | null;
};

// ----------------------------
// Ingredient DTOs / Commands
// ----------------------------

// Command to add an ingredient to a recipe (recipe_id provided in path)
export type CreateIngredientCommand = {
  name: IngredientInsert['name'];
  normalized_name: IngredientInsert['normalized_name'];
  quantity: IngredientInsert['quantity'];
  unit_id?: IngredientInsert['unit_id'] | null;
  unit_text?: IngredientInsert['unit_text'] | null;
};

export type IngredientResponseDTO = IngredientRow;

// ----------------------------
// Units
// ----------------------------

export type UnitDTO = UnitRow;

// ----------------------------
// IngredientNutrients (cache)
// ----------------------------

export type IngredientNutrientDTO = IngredientNutrientRow;

// Command to create or seed an ingredient nutrient mapping (admin/service)
export type CreateIngredientNutrientCommand = Omit<
  Database['public']['Tables']['ingredient_nutrients']['Insert'],
  'id' | 'generated_at' | 'stale_at'
> & { provenance?: Json };

// Query params for lookup endpoint
export type IngredientNutrientsLookupQuery = {
  normalized_name?: string;
  model?: string;
  prompt_hash?: string;
  autofetch?: boolean; // if true, API may enqueue an AI job and return 202
};

// ----------------------------
// AI Jobs
// ----------------------------

export type AIJobDTO = AIJobRow;

// Command to enqueue an AI job from API. Keep payload generic (Json) to allow different job types
export type CreateAIJobCommand = {
  recipe_id?: AIJobRow['recipe_id'] | null;
  requested_by_user_id?: AIJobRow['requested_by_user_id'] | null;
  type: AIJobRow['type'];
  payload?: Json | null;
};

export type AIJobListQuery = {
  status?: AIJobRow['status'];
  page?: number;
  per_page?: number;
};

// Control actions for a job
export type AIJobControlResponse = {
  id: AIJobRow['id'];
  status: AIJobRow['status'];
};

// ----------------------------
// Audit
// ----------------------------

export type RecipeAuditDTO = RecipeAuditRow;

// ----------------------------
// AI Operation / Modify endpoints (synchronous or async)
// ----------------------------

export type AIConstraint = {
  avoid_allergens?: boolean;
  disease_focus?: string | null; // e.g. 'celiac'
  // extendable for more constraint options
};

export type AIChange = {
  original: string;
  substitute: string;
  reason?: string;
};

export type AIOperationRequestDTO = {
  operation: 'substitution' | 'nutrition' | 'modify';
  constraints?: AIConstraint;
  timeout_ms?: number; // API may enforce SLOs (e.g. 5s)
  // for recipe-scoped operations the recipe id is provided in the path; payload may include extras
  payload?: Json | null;
};

export type AIOperationResponseDTO =
  | {
      status: 'ok';
      modified_recipe?: RecipeResponseDTO;
      explanations?: AIChange[];
      computed_nutrition?: Json | null;
    }
  | {
      status: 'queued';
      job_id: string;
      poll: string; // URL to poll job status
    };

// ----------------------------
// Pagination / common types
// ----------------------------

export type PaginationMeta = {
  page: number;
  per_page: number;
  total: number;
};

export type ListResponse<T> = {
  data: T[];
  meta: PaginationMeta;
};

// ----------------------------
// Utility / Validation helpers (exported for reuse)
// ----------------------------

// Partial but require specific keys helper: RequireKeys<T, K>
export type RequireKeys<T, K extends keyof T> = T & { [P in K]-?: T[P] };

// Example: a create DTO that requires title & recipe_data
export type CreateRecipeCommandRequired = RequireKeys<CreateRecipeCommand, 'title' | 'recipe_data'>;
