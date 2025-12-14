# Specyfikacja funkcjonalności autoryzacji (rejestracja / logowanie / odzyskiwanie hasła)

Krótki plan: opisuję architekturę UI, logikę backendową i integrację z Supabase Auth. Zawieram kontrakty API, walidacje, przypadki błędów i rekomendacje zabezpieczeń, tak aby implementacja mogła być wprowadzona bez naruszania istniejącej aplikacji.

---

Spis treści
- 1. Założenia i kontekst
- 2. ARCHITEKTURA INTERFEJSU UŻYTKOWNIKA
  - Strony i komponenty
  - Podział odpowiedzialności (Astro vs React)
  - Walidacja i komunikaty błędów
  - Scenariusze i przepływy użytkownika
- 3. LOGIKA BACKENDOWA
  - Endpointy API i kontrakty
  - Modele danych
  - Walidacja i wyjątki
- 4. SYSTEM AUTENTYKACJI (Supabase Auth)
  - Flows: rejestracja, logowanie, logout, reset
  - Tokeny, sesje i cookie handling
  - Email templates i bezpieczeństwo
- 5. Zabezpieczenia i produkcyjne uwagi
- 6. Testy, monitoring i wdrożenie

---

1) Założenia i kontekst
- Tech stack: Astro 5 (strony statyczne + SSR), TypeScript 5, React 18 (komponenty klienta), Tailwind 3.4. Projekt korzysta z Supabase (baza + auth).
- Nie zmieniamy dotychczasowych tabel użytkowników bez koordynacji z istniejącą bazą. Rozszerzenia powinny używać dedykowanej tabeli profili jeśli potrzeba dodatkowych pól.

---

2) ARCHITEKTURA INTERFEJSU UŻYTKOWNIKA

2.1 Strony i komponenty (przykładowa struktura)
- Strony Astro (server-side / routing):
  - `/auth/login` – strona logowania (Astro page) renderująca layout AuthLayout i mountująca komponent React `AuthLoginForm`.
  - `/auth/register` – strona rejestracji (Astro) mountująca `AuthRegisterForm`.
  - `/auth/forgot` – strona „zapomniałem hasła” z komponentem `ForgotPasswordForm`.
  - `/auth/reset` – strona resetu hasła (token w query) mountująca `ResetPasswordForm`.
  - `/account` – strona ustawień konta (chroniona), mountująca `AccountSettings`.

- Komponenty React (client-side):
  - `AuthLoginForm` — formularz logowania (email, password, submit). Wysyła żądanie do backendu `/api/auth/login`.
  - `AuthRegisterForm` — formularz rejestracji (email, password, confirmPassword, optional displayName). Waliduje hasło klient-side, wysyła do `/api/auth/register`.
  - `ForgotPasswordForm` — input email -> `/api/auth/forgot`.
  - `ResetPasswordForm` — password + confirm + token -> `/api/auth/reset`.
  - `AuthProvider` / `useAuth` — hook i kontekst do utrzymania stanu autoryzacji (client-side). Pobiera `GET /api/auth/me` i utrzymuje session.
  - `ProtectedRoute` / `RequireAuth` — wrapper dla komponentów wymagających zalogowania (przekierowuje do `/auth/login`).
  - `AuthLayout` i `AppLayout` — różne layouty; `AuthLayout` prosty centrowany, `AppLayout` z nawigacją i stanem użytkownika.

2.2 Podział odpowiedzialności (Astro vs React)
- Astro (strony): odpowiada za routing i wstępne renderowanie HTML oraz za wstrzyknięcie właściwych komponentów React tam, gdzie potrzebna jest interakcja. Strony powinny być „thin”: mountują komponenty klienta i przekazują ewentualne wartości z serwera (np. csrf token, initial props).
- React (komponenty klient-side): obsługa formularzy, walidacja klient-side, animacje, UX, lokalny state. Komponenty wywołują bezpieczne backendowe endpointy (nie Supabase bezpośrednio z klienta), chyba że celowo używamy Supabase client na przeglądarce dla magic linków itp.

2.3 Walidacja i komunikaty błędów
- Walidacje klient-side (szybka informacja):
  - Email: RFC-like regex, natychmiastowy feedback.
  - Hasło: min 8 znaków, co najmniej 1 wielka litera, 1 mała, 1 cyfra; przy rejestracji wskazać poziom siły hasła.
  - Confirm password: równość.
- Walidacje server-side (definitywne): powtórzyć te same reguły i dodatkowo:
  - Sprawdzić unikalność email.
  - Ograniczenia rate-limit (np. max X prób na minutę per IP/email).
- Komunikaty błędów: ustandaryzowane kody i treści (np. { code: 'INVALID_CREDENTIALS', message: 'Nieprawidłowy email lub hasło' }). Użytkownik dostaje przyjazną treść; backend loguje szczegóły.

2.4 Scenariusze i UX flows
- Rejestracja (happy path): user wypełnia formularz, walidacja, wysyłka -> backend rejestruje usera w Supabase Auth (signUp) + utworzenie profilu (optional) -> automatyczne zalogowanie lub wymaganie potwierdzenia e-mail (konfigurowalne).
- Logowanie: email/password -> backend używa Supabase signIn -> ustawia secure cookie (HTTPOnly) zawierające session lub przekazuje tokeny w bezpieczny sposób.
- Forgot password: wysłanie emaila z linkiem reset (Supabase can send) -> użytkownik klika, trafia na `/auth/reset?access_token=...` -> reset hasła.
- Logout: `POST /api/auth/logout` -> supabase signOut -> clear cookie -> redirect.
- Protected pages: przy braku sesji redirect do `/auth/login` z returnTo param.

---

3) LOGIKA BACKENDOWA

3.1 Endpointy API (kontrakt JSON)
- POST /api/auth/register
  - Request: { email: string, password: string, displayName?: string }
  - Response 201: { userId: string, email: string }
  - Errors: 400 ValidationError, 409 EmailExists

- POST /api/auth/login
  - Request: { email: string, password: string }
  - Response 200: { userId: string, session: { access_token, expires_at } } (session może być ustawiona jako httpOnly cookie zamiast body)
  - Errors: 401 INVALID_CREDENTIALS, 429 TOO_MANY_ATTEMPTS

- POST /api/auth/logout
  - Request: {} (server reads cookie)
  - Response 204

- POST /api/auth/forgot
  - Request: { email: string }
  - Response 200: { ok: true } (nie ujawnia, czy email istnieje)

- POST /api/auth/reset
  - Request: { token: string, password: string }
  - Response 200: { ok: true }

- GET /api/auth/me
  - Auth required (cookie/jwt)
  - Response 200: { user: { id, email, email_confirmed }, profile?: { displayName, avatarUrl } }

3.2 Integracja z Supabase Auth i bazy
- Backendowe endpointy używają Supabase Admin client (server-side) lub Supabase SDK z service_role_key przy operacjach administracyjnych (np. tworzenie profilu bezpośrednio). Jednak service_role_key musi być bezpiecznie przechowywane w env i używane wyłącznie server-side.
- Krok rejestracji: wywołać supabase.auth.signUp({ email, password }) lub odpowiedni admin API; po sukcesie utworzyć w `profiles` (id=auth.user.id) dodatkowe atrybuty.

3.3 Modele danych
- profiles (jeśli potrzebne):
  - id: uuid (PK) = auth.user.id
  - email: string
  - display_name: string | null
  - created_at: timestamptz
  - locale, marketing_opt_in, etc.
- sessions — używane przez Supabase Auth (nie duplikować lokalnie)

3.4 Walidacja i wyjątki
- Używać zod / Joi / custom TypeScript validators server-side dla DTO.
- Standard błędów: { code: string, message: string, details?: any }
- Obsługa wyjątków: logować z poziomem error i zwracać ustandaryzowany client-friendly message; nie ujawniać stacków ani szczegółów internal.

---

4) SYSTEM AUTENTYKACJI — Supabase Auth

4.1 Podejście i zalecenia
- Preferuj flow: frontend -> server endpoint -> server używa Supabase server SDK (bezpieczny service role key) lub Supabase REST Admin API.
- Alternatywa: użycie Supabase client po stronie klienta do signUp/signIn (jeśli chcemy magic link / social auth bez pośrednika). Jeśli używamy client-side signIn, nie wystawiaj service_role_key.

4.2 Rejestracja i potwierdzenie e‑mail
- Przy rejestracji: ustawić opcję wymagania potwierdzenia email (konfig w Supabase). Jeśli wymagane — zablokować dostęp do chronionych zasobów do momentu potwierdzenia (pole email_confirmed w `auth.users`).

4.3 Reset hasła
- Wywołać Supabase `resetPasswordForEmail` (Supabase wyśle email z tokenem) lub nasz endpoint, który wyśle email poprzez SMTP. Link w emailu prowadzi do `/auth/reset?token=...`.

4.4 Sesje i cookie handling
- Rekomendacja: serwer ustawia HTTPOnly, Secure, SameSite=Lax cookie zawierające session/token (zastępując expose token w JS). Alternatywnie użyć Supabase JS client i localStorage (mniej bezpieczne).
- Odświeżanie tokena: Supabase może udostępniać refresh tokeny; implementacja backendowa powinna obsługiwać `/api/auth/refresh` jeśli nie używamy Supabase client on browser.

4.5 Uprawnienia i RBAC
- Wykorzystywać Row Level Security (RLS) w Supabase dla ograniczeń danych (np. `profiles` tylko do odczytu/zapisu przez właściciela). Backend może wykonywać operacje admin-level przy użyciu service_role_key.

---

5) ZABEZPIECZENIA I PRODUKCYJNE UWAGI
- Przechowywanie sekretów: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` w env / secrets manager (GH Secrets, Vault). Nie udostępniać klientowi.
- Rate limiting: chronić `/api/auth/login` i `/api/auth/forgot` (IP + email) — np. 5 prób / 10 min.
- Brute-force & account lockout: po N nieudanych próbach zablokować konto tymczasowo i powiadomić mailowo.
- CSRF: użyć SameSite cookies + CSRF tokeny dla mutacji jeśli endpointy są wywoływane z przeglądarki z cookie.
- XSS: sanityzacja inputów, Content Security Policy.
- Audyt: logowanie zdarzeń auth (login success/fail, password reset) do `auth_audit` tabeli.

---

6) TESTY, MONITORING I WDROŻENIE
- Testy jednostkowe: walidatory DTO, logika error mapping, mocks Supabase SDK.
- Testy integracyjne: uruchomić staging Supabase (dedykowany projekt) i e2e testy dla flows register/login/reset.
- CI: dodać joby test + lint + build; secrets dostępne tylko w CI i staging.
- Monitoring: alerty na podwyższony rate of auth errors, latency oraz spike 429.

---

7) Kontrakty API — przykłady JSON
- POST /api/auth/register
  - Request
  ```json
  { "email": "user@example.com", "password": "P@ssw0rd!", "displayName": "Jan" }
  ```
  - Success 201
  ```json
  { "userId": "uuid", "email": "user@example.com" }
  ```

- POST /api/auth/login
  - Request
  ```json
  { "email": "user@example.com", "password": "P@ssw0rd!" }
  ```
  - Success 200 (server sets httpOnly cookie; body minimal)
  ```json
  { "userId": "uuid", "expiresAt": 1690000000 }
  ```

- POST /api/auth/forgot
  - Request
  ```json
  { "email": "user@example.com" }
  ```
  - Success 200
  ```json
  { "ok": true }
  ```

- POST /api/auth/reset
  - Request
  ```json
  { "token": "..", "password": "NewP@ss1" }
  ```
  - Success 200
  ```json
  { "ok": true }
  ```

---

8) Realizacyjne wskazówki i kolejność prac
1. Zaprojektować/walidować API i DTO (zod). Dodać testy jednostkowe dla walidatorów.
2. Implementować backend endpoints w `src/pages/api/auth/*` (Astro server functions lub Node serverless) korzystając z Supabase server SDK. Zaimplementować ustawianie httpOnly cookie.
3. Dodać React формы i `useAuth` + `AuthProvider` (komponenty w `src/components/auth/*`), podłączyć do endpointów.
4. Dodać RLS i tabele `profiles` + migrations.
5. Dodać monitoring i rate-limit middleware.

---

9) Podsumowanie
Specyfikacja dostarcza komplet informacji do implementacji modułu auth bez naruszania istniejącej aplikacji. Kluczowe decyzje:
- używamy Supabase Auth jako źródła prawdy,
- preferujemy backend-proxy dla operacji auth (bez ujawniania service role key),
- sesje powinny być HTTPOnly cookies dla bezpieczeństwa.

Plik zapisany w: `.ai/auth-spec.md` — zawiera pełną specyfikację gotową do implementacji.

