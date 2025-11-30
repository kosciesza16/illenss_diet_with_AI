# REST API Plan

## Overview
This REST API plan maps the database schema and PRD requirements into a secure, versionable HTTP API suitable for an Astro + React frontend and Supabase backend. It focuses on user-centric recipe CRUD, profile management, ingredient→nutrient mapping, synchronous AI-driven operations with SLOs (<5s for simple operations), and asynchronous heavy AI jobs.

---

## 1. Resources
- Users — `users` table (application profile)
- AuthUserMap — `auth_user_map` table (maps Supabase auth users to internal user_id)
- Recipes — `recipes` table
- Ingredients — `ingredients` table (per-recipe normalized ingredients)
- Units — `units` table (canonical units)
- IngredientNutrients — `ingredient_nutrients` table (cached/AI-generated nutrient mappings)
- AIJobs — `ai_jobs` table (background tasks for heavy AI computations)
- RecipeAudit — `recipe_audit` table (audit trail)

---

## 2. Endpoints
Notes:
- All request/response bodies are JSON unless stated otherwise.
- All endpoints that modify or return user-specific data require authentication (Supabase JWT) and authorization mapping via `auth_user_map` → `user_id`.
- Use standard HTTP status codes. Error responses follow: { "error": { "code": string, "message": string, "details"?: any } }

### Common query params for list endpoints
- `page` (int, default 1), `per_page` (int, default 20, max 100)
- `sort` (string, e.g. `created_at:desc`), `q` (full-text query applied to `tsv` where applicable)
- Filters: resource specific (e.g., `owner_user_id`, `status`, `type`, `normalized_name`)

### Authentication header
- Authorization: `Bearer <access_token>` (Supabase JWT)

---

### Resource: Profile (Users)

1) Create/Update Profile
- Method: POST
- Path: /api/v1/profile
- Description: Create or update the logged-in user's profile (id derived from `auth_user_map`). If no mapping exists, server will create `auth_user_map` entry and a `users` row.
- Request JSON:
  {
    "disease": "type1_diabetes" | "celiac" | "lactose_intolerance",
    "age": number,
    "sex": "female" | "male" | "other" | "unspecified",
    "allergies"?: any[],
    "preferences"?: object
  }
- Response 200:
  {
    "user_id": "uuid",
    "disease": string,
    "age": number,
    "sex": string,
    "allergies": any[],
    "preferences": object,
    "created_at": string,
    "updated_at": string
  }
- Errors:
  - 400: validation error (e.g., missing or invalid `disease`, `age`, `sex`)
  - 401: missing/invalid token
  - 500: internal error

Validation rules enforced:
- `disease` must be one of allowed enum values
- `age` 0 ≤ age ≤ 150
- `sex` must match allowed enum

---

### Resource: Recipes

2) Create Recipe
- Method: POST
- Path: /api/v1/recipes
- Description: Create recipe for authenticated user. Server fills `owner_user_id` from mapping.
- Request JSON:
  {
    "title": "string",
    "raw_text": "string",
    "recipe_data": {
      "title": "string",
      "ingredients": [ { "name": "string", "quantity": number, "unit_id"?: "uuid", "unit_text"?: "string", "normalized_name"?: "string" } ],
      "steps": ["string"]
    }
  }
- Response 201 (created): recipe object with `id`, timestamps
- Errors:
  - 400: validation error (title empty, steps length, missing ingredient fields)
  - 401: unauthorized

Validation rules (API-level, mirror DB triggers):
- `title` non-empty
- `ingredients` array, each item must have `name` and `quantity>0`
- `steps` array, each step length between 10 and 500 characters

Implementation notes:
- Server runs additional lightweight checks and returns 400 with details before insert.
- After successful create, schedule asynchronous AI job(s) if requested (e.g., detailed nutrition) or compute quick mapping synchronously using cached `ingredient_nutrients`.

3) Get Recipe
- Method: GET
- Path: /api/v1/recipes/{id}
- Description: Return full recipe including `recipe_data`, `ingredients` rows, aggregated `cached_nutrition` and user-specific computed metadata (e.g. percent of daily need for disease profile).
- Response 200:
  {
    "id": "uuid",
    "owner_user_id": "uuid",
    "title": "string",
    "raw_text": "string",
    "recipe_data": object,
    "ingredients": [ ...ingredients rows... ],
    "cached_nutrition": object | null,
    "computed_nutrition": object | null,
    "created_at": string,
    "updated_at": string
  }
- Errors: 404 if not found, 403 if not authorized to access

4) Update Recipe
- Method: PUT
- Path: /api/v1/recipes/{id}
- Description: Replace recipe_data/title/raw_text. Must be owner.
- Request: same body as POST; partial updates allowed via PATCH endpoint (below).
- Response: 200 updated recipe
- Validation: same as create

5) Patch (partial update)
- Method: PATCH
- Path: /api/v1/recipes/{id}
- Description: Partial update for title, raw_text, recipe_data; update `updated_at` timestamp
- Request: partial fields
- Response: 200 updated recipe

6) Delete Recipe
- Method: DELETE
- Path: /api/v1/recipes/{id}
- Description: Soft delete (set `deleted_at`) or physical delete if admin or purge window.
- Response: 204 No Content on success
- Authorization: owner or admin

7) List Recipes
- Method: GET
- Path: /api/v1/recipes
- Query params: page, per_page, sort, q (search), owner_user_id (optional admin), include_deleted=false
- Response 200:
  {
    "data": [ recipe summary objects ],
    "meta": { "page": number, "per_page": number, "total": number }
  }

Indexes leveraged:
- GIN on `tsv` for `q` full-text search
- B-tree on `owner_user_id, created_at` for fast user listing

---

### Resource: Ingredients

8) Add Ingredient (per recipe)
- Method: POST
- Path: /api/v1/recipes/{recipe_id}/ingredients
- Request JSON:
  { "name": string, "quantity": number, "unit_id"?: "uuid", "unit_text"?: "string", "normalized_name"?: "string" }
- Response: 201 ingredient row
- Validation: `quantity > 0`, `name` non-empty
- Side effects: If `normalized_name` present, attempt to look up `ingredient_nutrients` cache and update `recipes.cached_nutrition` (async or sync depending on SLO)

9) Update/Delete Ingredient
- Method: PATCH / DELETE
- Path: /api/v1/recipes/{recipe_id}/ingredients/{ingredient_id}
- Validation: same as above

List ingredients for recipe: GET /api/v1/recipes/{recipe_id}/ingredients

---

### Resource: Units

10) List Units
- Method: GET
- Path: /api/v1/units
- Description: Public list of canonical units. Optional filters: `base_unit_type`.
- Response: list of unit objects

(Units management endpoints restricted to internal/admin)

---

### Resource: IngredientNutrients (cache)

11) Lookup nutrient mapping
- Method: GET
- Path: /api/v1/ingredient-nutrients
- Query params: `normalized_name`, `model` (optional), `prompt_hash` (optional)
- Description: Return cached nutrient mapping(s). If none and `autofetch=true`, trigger AI job to compute mapping (async) and return 202 with location to job.
- Response 200: list of nutrient mappings
- Response 202: { "job_id": "uuid", "status": "queued" }

12) Create mapping (admin/service)
- Method: POST
- Path: /api/v1/ingredient-nutrients
- Body: { normalized_name, nutrients, model, prompt_hash, provenance }
- Authorization: service or admin only (require service role)
- Use case: seed cache or insert AI-produced result

Indexes used:
- B-tree on `normalized_name` for fast lookup
- GIN on nutrients for JSON queries

---

### Resource: AI Jobs

13) Create AI Job (background)
- Method: POST
- Path: /api/v1/ai-jobs
- Body:
  {
    "recipe_id"?: "uuid",
    "requested_by_user_id"?: "uuid",
    "type": "detailed_nutrition" | "batch_recompute" | "refresh_ingredient" | "other",
    "payload"?: object
  }
- Behavior:
  - Validate not to create duplicate queued/in_progress job for same (recipe_id,type) — enforce via partial unique index.
  - Return 201 with job object (status queued)
- Response 201: job object
- Errors: 409 if duplicate prevented

14) List/Get AI Jobs (user or admin)
- Method: GET /api/v1/ai-jobs?status=&page=&per_page=
- Method: GET /api/v1/ai-jobs/{id}
- Authorization: owner or admin

15) Cancel / Retry job
- Method: POST /api/v1/ai-jobs/{id}/cancel
- Method: POST /api/v1/ai-jobs/{id}/retry
- Authorization: owner or admin

Background worker contract:
- Workers poll `ai_jobs` where status IN ('queued') and use locking (update locked_at/locked_by) to claim jobs.
- On success, worker sets status `succeeded`, sets `result` and `finished_at`.
- On fail, increment `attempts`, set `status` to `failed` after max retries.

Indexes used:
- Index on (status, created_at)
- Partial unique index to prevent duplicates: UNIQUE(recipe_id, type) WHERE status IN ('queued','in_progress')

---

## 3. Authentication and Authorization

Chosen mechanism: Supabase Auth (JWT tokens) + server-side mapping to internal `user_id` using `auth_user_map`.

Implementation details:
- Frontend obtains Supabase access token and sends it in Authorization header: `Bearer <token>`.
- API verifies signature (Supabase JWT public key) and decodes `sub` (auth user id).
- Map `sub` => `user_id` via `auth_user_map`. If not exists and endpoint allows creation (profile create), atomically create `auth_user_map` and `users` row.
- Protect service/admin-only endpoints using a server-side `SERVICE_ROLE_KEY` (server secret) or check for `role` claim if present. Never expose service role key to client.
- Row-level security (RLS): if using Supabase directly for some queries, use RLS policies to restrict access to rows owned by `auth.uid()` mapped to `user_id`.

Token validation and rotation:
- Validate standard claims (exp, iat)
- Reject tokens with missing `sub`

Rate limiting / abuse mitigation:
- Apply per-IP and per-user rate limits for expensive endpoints (AI endpoints). Example: 60 req/min for simple endpoints; 10 req/min for AI synchronous operations.
- Use request-level concurrency limiters for synchronous AI operations to protect downstream AI budget.

---

## 4. Validation and business logic mapping
This section maps PRD functions and DB validation to API implementation.

1. Recipe CRUD (PRD F1, US-004/005/006)
- API enforces `title` non-empty, `steps` required and each 10–500 chars, `ingredients[].name` present and `quantity > 0`. These checks run as guard clauses at the start of handlers and return 400 with details. DB trigger `validate_recipe_data()` is still present as last-resort enforcement.

2. Authentication and profile (PRD F2, US-001/002)
- API maps `auth` token to internal `user_id` using `auth_user_map`. On first login, create mapping and user profile row.
- Ensure profile fields `disease`, `age`, `sex` validated.

3. Synchronous AI adjustments & nutrient mapping (PRD F3/F4, US-007/008)
- For simple mapping and substitution operations, API attempts to serve synchronously using cached `ingredient_nutrients` and lightweight in-process rules (substitutions by allergen avoidance or disease rules). If the cache is insufficient or operation cost is high, return 202 and create `ai_jobs` for asynchronous processing.
- SLO enforcement: simple operations must return within 5s. Implement a per-request timeout and fallback to async queue with informative response.
- Computed response includes `computed_nutrition` object with aggregated nutrients and percent of daily need (server computes using disease/age/sex profile and a nutritional reference table).

4. Heavy AI operations (PRD: detailed nutrition)
- Enqueue into `ai_jobs` with type `detailed_nutrition`. Provide a `GET /api/v1/ai-jobs/{id}` to poll status and obtain result. Webhook/Push notifications optional.

5. Ingredient→nutrient cache (PRD F4)
- When a new `normalized_name` is added, API will look up `ingredient_nutrients`. If not present and auto-seed is allowed, create `ai_job` to compute mapping and return 202 referencing job.
- Admin/service endpoints allow seeding and bulk import of nutrient mappings.

6. Prevent duplicate AI jobs
- API must check for existing queued/in_progress job for (recipe_id,type) and return 409 or reuse existing job id. This is enforced both at DB partial unique index and at API layer with a short transaction.

---

## 5. Error handling and responses
- Standard error format: { "error": { "code": "bad_request", "message": "Detailed message", "details": {...} } }
- Validation errors return 400 with `details: { field: message }`.
- Authorization errors return 401 (unauthenticated) or 403 (authenticated but forbidden).
- Conflict (duplicate job) returns 409 with existing resource link.

---

## 6. Pagination, filtering and sorting details
- Pagination: cursor or page-based; default page-based for simplicity: `page`, `per_page`. Provide in responses `meta.total`, `meta.page`, `meta.per_page`.
- Sorting: `sort=field:dir` supporting multiple comma-separated fields.
- Filtering: allow resource-specific filters (e.g., `status`, `type`, `owner_user_id`).

---

## 7. Security & production hardening
- Secrets: Service role keys live only on server and in CI; never sent to client. Use environment secrets and server-only endpoints.
- RLS: Where possible, enforce row-level security in Supabase so queries from client-side SDK are constrained. Server API should perform additional checks when performing operations.
- Rate limiting & quotas for AI endpoints.
- Input sanitization: protect against oversized JSON bodies, expensive regexes. Limit body size (e.g., 1MB for recipe create).
- Logging & observability: structured logs for AI job lifecycle.
- Data privacy: anonymize identifiers when sending data to third-party AI providers; remove PII.
---

## 8. Next steps (implementation plan)
1. Define DTOs and JSON schemas for all endpoints and implement request validation middleware.
2. Implement auth middleware: JWT validation + `auth_user_map` resolution.
3. Implement ingredient_nutrients lookup with seed import endpoints.




