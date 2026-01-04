Frontend - Astro z React dla komponentów interaktywnych:
- Astro 5 pozwala na tworzenie szybkich, wydajnych stron i aplikacji z minimalną ilością JavaScript
- React 18 zapewni interaktywność tam, gdzie jest potrzebna
- TypeScript 5.5 dla statycznego typowania kodu i lepszego wsparcia IDE
- Tailwind 4 pozwala na wygodne stylowanie aplikacji

Backend - Supabase jako kompleksowe rozwiązanie backendowe:
- Zapewnia bazę danych PostgreSQL
- Zapewnia SDK w wielu językach, które posłużą jako Backend-as-a-Service
- Jest rozwiązaniem open source, które można hostować lokalnie lub na własnym serwerze
- Posiada wbudowaną autentykację użytkowników

AI - Komunikacja z modelami przez usługę Openrouter.ai:
- Dostęp do szerokiej gamy modeli (OpenAI, Anthropic, Google i wiele innych), które pozwolą nam znaleźć rozwiązanie zapewniające wysoką efektywność i niskie koszta
- Pozwala na ustawianie limitów finansowych na klucze API

CI/CD i Hosting:
- Github Actions do tworzenia pipeline’ów CI/CD
- DigitalOcean do hostowania aplikacji za pośrednictwem obrazu docker

Testowanie jednostkowe i narzędzia powiązane:
- Vitest — preferowany runner do testów jednostkowych i integracyjnych lekko związanych z Vite/Astro.
- @testing-library/react — biblioteka do testowania komponentów React z punktu widzenia użytkownika.
- msw (Mock Service Worker) — do mockowania żądań sieciowych (Supabase, OpenRouter) w testach jednostkowych i integracyjnych.
- @testing-library/user-event — do symulacji interakcji użytkownika w testach.
- @testing-library/jest-dom — rozszerzenia asercji DOM ułatwiające czytelną weryfikację wyników testów.

Zalecenia:
- Uruchamiać testy z `vitest` w trybie watch podczas developmentu, a w CI użyć pojedynczego przebiegu (CI mode).
- Przygotować `test/setup.ts` do globalnej konfiguracji środowiska testowego (np. `msw` handlers, globalne matchery `jest-dom`, renderowanie w providerach).
- Izolować komponenty i mockować zależności zewnętrzne (Supabase, OpenRouter) przy pomocy `msw` lub prostej strategii stubów.
