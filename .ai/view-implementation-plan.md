# API Endpoint Implementation Plan: Create Recipe (POST /api/v1/recipes)

## 1. Overview
This plan describes how to implement the "Create Recipe" endpoint that allows authenticated users to create a recipe in the system. The endpoint will validate incoming data, persist a `recipes` row and associated `ingredients`, trigger/queue post-processing tasks (nutrition computation or AI jobs) and write an audit record. The implementation targets the project's stack: Astro + TypeScript (server endpoints), Supabase/Postgres (DB), and the existing `src/types.ts` DTOs.

Goals:
- Correct, validated persistence of recipe and ingredients.
- Keep server-only secrets off client bundles.
- Fast synchronous path for cheap operations, async fallback for heavy AI work.
- Proper authorization and audit logging.


## 2. Request details
- Method: POST
- URL: `/api/v1/recipes`
- Auth: Required — Authorization: `Bearer <supabase_access_token>`

### Required parameters (request body JSON)
- `title` (string) — non-empty
- `raw_text` (string) — full recipe text
- `recipe_data` (object) — structured content:
  - `title` (string)
  - `ingredients` (array) — each item:
    - `name` (string) — non-empty
    - `quantity` (number) — > 0
    - `unit_id` (uuid, optional) or `unit_text` (string, optional)
    - `normalized_name` (string, optional) — recommended
  - `steps` (array of strings) — each 10–500 chars

### Optional parameters
- `enqueue_ai` (boolean) — if true, schedule detailed nutrition AI job after creation (default: false)
- `compute_quick_nutrition` (boolean) — if true, attempt synchronous cached lookup (bounded by SLO) (default: true)

### Relevant DTOs / Commands
- `CreateRecipeCommand` (src/types.ts)
- `RecipeDataDTO`, `RecipeDataIngredientDTO` (src/types.ts)
- `CreateAIJobCommand` (src/types.ts) — for optional job scheduling
- `RecipeResponseDTO` — response shape


## 3. Response details
- Success (201 Created)
  - Body: `RecipeResponseDTO` (full recipe object including `id`, timestamps, `recipe_data`, `ingredients` list, `cached_nutrition` possibly null)
- Validation error (400)
  - Body: `{ error: { code: 'bad_request', message: 'Validation failed', details: { field: 'reason' } } }
- Unauthorized (401)
  - Body: `{ error: { code: 'unauthorized', message: 'Missing or invalid token' } }
- Forbidden (403) — not expected for create (user always creates own recipe) but reserved
- Server error (500)
  - Body: `{ error: { code: 'internal_error', message: 'Detailed message' } }

Notes:
- If a synchronous quick nutrition computation is requested and SLO exceeded, return `201` with recipe but include a header/field indicating an AI job was queued (202-style behavior for the heavy compute is surfaced via `ai_jobs`).


## 4. Data flow
1. Incoming request -> API route handler (server-side).
2. Auth middleware validates Supabase JWT and maps `sub` -> internal `user_id` via `auth_user_map` (create mapping if needed).
3. Validate payload against DTO schema (Zod recommended). Apply guard clauses (fail fast).
4. Begin DB transaction:
   a. Insert `recipes` row (owner_user_id = mapped user_id) with `recipe_data` as JSONB and `raw_text`.
   b. Insert `ingredients` rows for each item (use `normalized_name` if present), referencing `recipe_id`.
   c. Optionally write `cached_nutrition` if quick compute succeeded.
   d. Insert `recipe_audit` row with action `create` and meta containing request summary.
   e. Commit transaction.
5. If `enqueue_ai` requested or quick nutrition unavailable, create `ai_jobs` row(s) (create via `CreateAIJobCommand`): either inside same transaction (preferred) or in a subsequent safe step.
6. Return 201 Created with assembled `RecipeResponseDTO`.

External interactions:
- Supabase authentication service for token verification (server verifies token or uses SDK).
- Optional AI worker/queue — enqueue job for post-processing (detail nutrition). Worker later updates `ai_jobs.result` and `recipes.cached_nutrition`.


## 5. Security considerations
- Authentication: require valid Supabase access token. Verify server-side using Supabase SDK or JWT library; extract `sub` claim.
- Authorization: creation is allowed for any authenticated user; ensure `owner_user_id` is set from mapping, never from client payload.
- Secrets: use server-only `SERVICE_ROLE_KEY` for admin operations; never expose in client bundles.
- Input sanitization: enforce strict payload size limit (e.g., 1MB) and field length limits to avoid DOS or expensive DB operations.
- SQL injection: use Supabase client/parameterized queries, avoid raw string interpolation.
- Rate limiting: apply per-user rate limiting (e.g., 60 req/min) for create endpoints to prevent abuse.
- PII handling: do not send full PII to AI providers; anonymize data where required.


## 6. Error handling
- Validation failures -> 400 with field-level details (return from validation middleware).
- Auth failures -> 401.
- Duplicate resource (rare for create) -> 409 (if business rule triggers duplicate detection).
- DB/transient errors -> 500. If DB transaction fails, roll back and return 500. Log as structured error and insert into `recipe_audit` with action `create_failed` (include error meta) or to a dedicated `error_logs` table if available.
- AI enqueue conflict (duplicate job) -> API should detect existing queued/in_progress job via partial unique index; if conflict, return 409 with existing `job_id` link.

Error logging:
- Use structured server logs (JSON) and integrate with Sentry/LogDNA/Cloud provider.
- Persist important events to `recipe_audit` table (action: create, create_failed) with `meta` containing sanitized request payload and error details.


## 7. Performance considerations
- Single DB transaction for recipe + ingredients to ensure consistency.
- Rely on DB trigger to update `tsv` for full-text search; ensure index `idx_recipes_tsv_gin` exists.
- Use bulk INSERT for ingredients to minimize round-trips.
- Quick nutrition path: use `ingredient_nutrients` lookup with B-tree on `normalized_name`; limit synchronous work to a tight timeout (e.g., 3s) — if exceeded, enqueue AI job and return recipe without computed nutrition.
- Background workers process heavy AI tasks and update `recipes.cached_nutrition` asynchronously.
- Pagination and listing endpoints are separate; for create ensure minimal response size.


## 8. Implementation details and file map
Recommended files to add/change (TypeScript):
- `src/pages/api/v1/recipes/post.ts` (or framework-appropriate route) — route handler
- `src/services/RecipeService.ts` — encapsulate business logic: validation, transaction, audit, job enqueue
- `src/lib/supabase.client.ts` — reuse existing typed client
- `src/validators/recipe.validator.ts` — Zod schema for `CreateRecipeCommand` / `RecipeDataDTO`
- `src/controllers/recipeController.ts` — thin controller that uses service (optional)
- `src/workers/aiWorkerContract.md` — doc describing job payloads and worker contract

Suggested function signatures (TypeScript):
- RecipeService.createRecipe(userId: string, cmd: CreateRecipeCommand, opts?: { enqueueAI?: boolean, computeQuickNutrition?: boolean }): Promise<RecipeResponseDTO>
- RecipeService.validateRecipeData(cmd: CreateRecipeCommand): ValidationResult
- AIService.createJob(cmd: CreateAIJobCommand): Promise<AIJobDTO>

Data access pattern:
- Use Supabase client with `from('recipes').insert(...)` and `from('ingredients').insert(...)` inside a transaction (use Postgres transaction via RPC or server-side transaction wrapper if using direct connection). If using Supabase REST/SDK without transaction support, perform inserts carefully and design compensating logic on failure.


## 9. Validation rules (detailed)
Server-side validation (mirror DB triggers):
- `title`: non-empty, max length 300
- `raw_text`: non-empty
- `recipe_data.title`: non-empty
- `ingredients`: present and array
  - each `name`: non-empty, max length 200
  - each `quantity`: number > 0
  - `unit_id` must be valid UUID if provided; `unit_text` max length 100
  - if `normalized_name` present, normalize (lowercase + trim) and check length
- `steps`: array, each step 10–500 characters

Validation implementation:
- Use Zod schemas for request validation. Return a structured error response with `details` per-field.


## 10. Audit and observability
- Write `recipe_audit` rows for significant events (create, create_failed). Fields: `action`, `anonymized_id` (if applicable), `recipe_id`, `user_id`, `meta` (JSON with sanitized request), `created_at`.
- Emit structured logs at start, after DB commit, and on error. Include correlation id (X-Request-Id) for tracing.


## 11. Error scenarios and status mapping
- Bad payload / validation error -> 400
- Missing/invalid auth -> 401
- DB constraint violation (e.g., invalid unit_id foreign key) -> 400 or 422 mapped to 400 with detail
- Transaction failure / DB unavailable -> 500
- Duplicate AI job detected when enqueuing -> 409 with existing job link
- Large payload -> 413 Payload Too Large (server may enforce), but if not supported return 400 with message


## 12. Implementation checklist (step-by-step)
1. Add Zod validators: `src/validators/recipe.validator.ts` for `CreateRecipeCommand` and nested structures.
2. Implement auth middleware if missing: validate Supabase JWT, map `sub` -> `user_id` via `auth_user_map`. Prefer creating mapping atomically if absent.
3. Create `RecipeService` with `createRecipe` as per function signature. Implement DB transaction logic:
   - Insert recipe, bulk insert ingredients, insert audit row.
   - Use a Postgres transaction to ensure atomicity (if using Supabase SDK, use server-side direct DB connection or RPC to perform transaction).
4. Implement synchronous quick nutrition lookup inside `RecipeService` with short timeout; if not available queue AI job.
5. Ensure `ai_jobs` enqueue uses partial-unique index logic to avoid duplicates. Handle conflict and return existing job id if duplicate.
6. Implement the route handler `src/pages/api/v1/recipes/post.ts` that:
   - Parses and validates body via Zod
   - Authenticates & resolves `user_id`
   - Calls `RecipeService.createRecipe`
   - Returns 201 with `RecipeResponseDTO` or appropriate error
7. Add `recipe_audit` writes and structured logging.
8. Add unit tests for validators and `RecipeService`.
9. Add integration test hitting `/api/v1/recipes` with mocked Supabase and DB.
10. Run typechecking (`npm run typecheck`) and linting, fix issues.
11. Add deployment notes: ensure environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY`) are available in server environment and CI secrets.


## 13. Acceptance criteria
- Endpoint accepts valid payloads and creates recipe + ingredient rows atomically.
- Validations return clear 400 responses on invalid input.
- Authenticated users become owners of their created recipes; owner_user_id is never taken from client payload.
- Quick nutrition path returns computed nutrition when cache permits within SLO; otherwise an AI job is enqueued and eventual update occurs.
- Audit rows are created for successful and failed creates.
- Tests (unit + integration) pass in CI; linter and typecheck are clean.


## 14. Open questions / assumptions
- Transaction support: Implementation assumes we can run DB transactions server-side. If using Supabase client without transaction capability, implement a server-side RPC or a direct DB connection for transaction guarantees.
- Normalization: Client may supply `normalized_name` but server will also normalize and validate it.
- Nutrition reference data must be available to compute percent of daily needs; if missing, return raw aggregates only.


---

*This file was generated as a developer-facing implementation plan. Placeholders like `src/pages/api/v1/recipes/post.ts` should be adapted to your route conventions (Astro server routes or API functions).*
