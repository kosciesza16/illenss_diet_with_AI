# OpenRouter Service — Plan implementacji

## 1. Opis usługi

`OpenRouterService` to lekka, testowalna usługa TypeScript służąca do komunikacji z API OpenRouter w kontekście aplikacji Astro 5 + TypeScript 5 (Vite) i React 18. Ma na celu:  
- wysyłanie konwersacji (system/user) do modelu LLM,  
- obsługę ustrukturyzowanych odpowiedzi przez `response_format` (JSON Schema),  
- retry/backoff, rate-limit handling i streaming (opcjonalnie).  

Usługa celuje w środowiska serverless (np. Vercel, Netlify) lub w API serwera Node obsługującego żądania po stronie serwera.

---

## 2. Opis konstruktora

Konstruktor klasy `OpenRouterService` przyjmuje obiekt konfiguracyjny z następującymi polami:

- `apiKey: string` — klucz API OpenRouter (wymagane). Domyślnie czytane z env `OPENROUTER_API_KEY`.
- `baseUrl?: string` — baza URL API (domyślnie: `https://api.openrouter.ai` lub konfigurowalny endpoint). Typ: `string`.
- `defaultModel?: string` — nazwa domyślnego modelu (np. `gpt-4o-mini`) (domyślnie: `gpt-4o-mini`). Typ: `string`.
- `timeoutMs?: number` — timeout dla zapytań w ms (domyślnie: `15000`). Typ: `number`.
- `maxRetries?: number` — maksymalna liczba retry przy błędach sieciowych (domyślnie: `3`). Typ: `number`.
- `logger?: Logger` — opcjonalny logger z metodami `info/debug/warn/error` (domyślnie: console-wrapper).
- `responseSchemaRegistry?: Record<string, JSONSchema>` — opcjonalny rejestr schematów odpowiedzi używanych przez `response_format`.
- `rateLimitPolicy?: { maxRequests:number; windowMs:number }` — (opcjonalne) lokalne ograniczenia.

Zachowanie domyślne: walidacja wejścia konstruktora i wczesne rzucanie błędów (guard clauses). Konstruktor nie inicjuje połączeń sieciowych; tworzy klienta HTTP i kontekst konfiguracyjny.

---

## 3. Publiczne metody i pola

Wszystkie sygnatury w TypeScript (skrótowo):

- class OpenRouterService {

  - public readonly baseUrl: string
  - public readonly defaultModel: string

  - constructor(config: OpenRouterConfig)

  - async sendMessage(messages: OpenRouterMessage[], opts?: { model?: string; params?: Record<string, any>; responseFormat?: ResponseFormatSpec; timeoutMs?: number; }): Promise<OpenRouterResponse>
    - Opis: wysyła listę wiadomości (system/user) jako standardowy request.
    - Brzegi: jeśli `messages` puste => rzuca `ValidationError`.

  - async sendStructuredMessage(messages: OpenRouterMessage[], responseFormat: ResponseFormatSpec, opts?: { model?: string; params?: Record<string, any> }): Promise<StructuredResult>
    - Opis: wymusza `response_format` (JSON schema) i waliduje wynik przed zwróceniem.
    - Brzegi: przy błędzie walidacji => rzuca `ResponseFormatError` z przyczyną i surową odpowiedzią.

  - setSystemMessage(message: string): void
    - Opis: zapisuje/aktualizuje domyślny komunikat systemowy używany w kolejnych zapytaniach.

  - setModel(modelName: string): void
    - Opis: ustawia `defaultModel` runtime.

  - setParams(params: Record<string, any>): void
    - Opis: nadpisuje/merguje domyślne parametry modelu (np. temperature, max_tokens).

  - streamResponses(messages: OpenRouterMessage[], opts?: { model?: string; params?: Record<string, any> }): AsyncIterable<StreamChunk>
    - Opis: (opcjonalnie) otwiera streaming odpowiedzi i yielduje parsowane fragmenty.
    - Brzegi: jeśli API nie obsługuje streamingu — rzuca `UnsupportedFeatureError`.

  - async healthCheck(): Promise<{ ok: boolean; latMs?: number; details?: any }>
    - Opis: prosty sprawdzian OK (auth + ping endpoint).

  - async shutdown(): Promise<void>
    - Opis: zamyka zasoby, anuluj zaległe retry/timeouty.

}

Typy pomocnicze (skrót):
- OpenRouterMessage = { role: 'system'|'user'|'assistant', content: string }
- ResponseFormatSpec = { type: 'json_schema', json_schema: { name: string, strict: boolean, schema: JSONSchema } }
- JSONSchema = standardowy obiekt JSON Schema v7+ (używany do walidacji)

---

## 4. Prywatne metody i pola

Opiszemy kluczowe utility, które pozostają prywatne:

- private httpClient
  - wrapper fetch/axios z timeout i automatycznym dodawaniem nagłówków (Authorization, Content-Type).

- private buildPayload(messages, opts): OpenRouterPayload
  - buduje payload zawierający `messages`, `model`, `params` oraz `response_format` jeśli podano.
  - guard clauses: waliduje obecność przynajmniej jednej wiadomości.

- private async handleOpenRouterResponse(res): Promise<any>
  - Parsuje odpowiedź API; rozpoznaje błędy aplikacyjne i formatuje uniform error object.
  - Jeśli `response_format` było użyte, wywołuje walidator JSON Schema przed zwróceniem.

- private retryWithBackoff(fn, retries): Promise
  - Implementuje exponencjalny backoff z jitter.

- private rateLimitHandler(headers|body): void
  - Wyciąga nagłówki rate-limit z odpowiedzi i harmonizuje lokalną politykę (opcjonalnie sleep/retry).

- private parseStreamingChunk(chunk): StreamChunk
  - Parsuje chunk z SSE/stream i zwraca ustrukturyzowany fragment.

- private logAndMaskSensitiveData(obj): void
  - Loguje obiekty, maskując klucze API, tokeny i wartości wrażliwe.

---

## 5. Obsługa błędów

Zalecane klasy/typy błędów:

- OpenRouterError extends Error { code: string; status?: number; cause?: any }
  - Ogólny wrapper dla błędów API.

- AuthenticationError extends OpenRouterError (code = 'AUTH')
  - Gdy brak/nieprawidłowy klucz API.

- NetworkError extends OpenRouterError (code = 'NETWORK')
  - Gdy fetch/timeout/ETC.

- RateLimitError extends OpenRouterError (code = 'RATE_LIMIT', retryAfter?: number)
  - Gdy odpowiedź 429.

- ResponseFormatError extends OpenRouterError (code = 'FORMAT', details: ValidationError[])
  - Jeśli wynik nie przechodzi walidacji JSON Schema.

- ValidationError extends OpenRouterError (code = 'VALIDATION')
  - Błędy walidacji wejściowej (np. pusty messages).

Dobre praktyki: każdemu błędowi dołączaj `hint` i `safePayload` (wersję payloadu z zamaskowanymi danymi) do loggingu. Używaj kodów HTTP i wewnętrznych kodów `code` dla łatwego mapowania w monitoringu.

---

## 6. Kwestie bezpieczeństwa

1. Ochrona kluczy API
   - Trzymaj `OPENROUTER_API_KEY` w env (server-side). Nie przesyłaj na klienta.
   - W CI przechowuj sekrety w bezpiecznym systemie sekretów; nie narzucamy konkretnego rozwiązania.

2. Maskowanie logów
   - Nigdy nie zapisuj surowych kluczy/tokenów. Używaj `logAndMaskSensitiveData`.

3. Input/Output validation
   - Waliduj wszystkie wejścia (messages, params) oraz odpowiedzi (response_format).

4. Rate limiting & throttling
   - Wprowadź client-side rate limits oraz wykrywanie 429 z exponential backoff.

5. Polityki CORS & CSRF
   - Jeśli endpoint udostępnia API publiczne, stosuj ograniczenia CORS i CSRF tokeny. Klient powinien wywoływać backend endpoint, który następnie wywołuje OpenRouter.

6. Bezpieczne wartości domyślne
   - `timeoutMs` umiarkowany (np. 15s), `maxRetries` ograniczony (3), `defaultModel` ustalony tak, by nie używać eksperymentalnych modeli domyślnie.

---

## 7. Plan wdrożenia krok po kroku

1. Utwórz plik usługi
   - Lokalizacja: `src/services/OpenRouterService.ts`
   - Stwórz klasę `OpenRouterService` z konstruktorami i polami.

2. Implementacja podstawowych metod
   - `buildPayload`, `sendMessage`, `handleOpenRouterResponse`.
   - Dodaj prosty `logger` i `httpClient` (fetch wrapper z timeout).

3. Dodaj walidację schematów
   - Zależność: `ajv` (lekki validator JSON Schema). Rejestruj schematy w `responseSchemaRegistry`.
   - Przykład response_format (JSON schema):

```json
{ "type":"json_schema","json_schema":{
  "name":"nutrition_response",
  "strict":true,
  "schema":{
    "type":"object",
    "properties":{
      "recipeId":{"type":"string"},
      "nutrition":{
        "type":"object",
        "properties":{
          "calories":{"type":"number"},
          "protein_g":{"type":"number"}
        },
        "required":["calories","protein_g"]
      },
      "warnings":{"type":"array","items":{"type":"string"}}
    },
    "required":["recipeId","nutrition"]
  }
}}
```

4. Implementuj `sendStructuredMessage` — buduje payload z powyższym `response_format` i waliduje wynik.

5. Retry, backoff i rate-limit
   - Dodaj `retryWithBackoff` z jitter oraz obsługę 429 (użyj `Retry-After` nagłówka).

6Integracja w aplikacji
   - Backend: expose bezpieczny endpoint `POST /api/llm/chat` w `src/pages/api` (server-side), który używa `OpenRouterService`.
   - Frontend: komponent React wysyła requesty do backendu (nie bezpośrednio do OpenRouter).

Przykładowe komendy PowerShell do lokalnego sprawdzenia (Vite/TypeScript):

```powershell
# install dependencies
npm install;
# lint
npm run lint;
# run unit tests
npm test;
# build
npm run build;
# run dev
npm run dev;
```

---

### Krótkie przykłady payload i użycia (TypeScript inline)

1) Budowa payload:

```ts
const payload = {
  model: service.defaultModel,
  messages: [
    { role: 'system', content: service.getSystemMessage() },
    { role: 'user', content: 'Podaj wartości odżywcze dla przepisu X' }
  ],
  params: { temperature: 0.2 },
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'nutrition_response', strict: true,
      schema: { /* schema jak wyżej */ }
    }
  }
};
```

2) Obsługa odpowiedzi i walidacja:

```ts
const res = await service.sendStructuredMessage(messages, responseFormatSpec);
// res ma typ StructuredResult, walidowany zgodnie z schema
```

---

## Wymagania pokryte

- Integracja system/user message: opisano w `buildPayload` i przykładach.
- response_format: podano konkretny JSON Schema i wzór jak przekazać.
- Nazwa modelu i parametry modelu: pola `model` i `params` oraz metody `setModel`/`setParams`.
- Obsługa błędów i bezpieczeństwo: opisane osobno z klasami błędów i zasadami.
- Plan wdrożenia: krok-po-kroku + PowerShell commands.

---

Plik gotowy do zapisania i dalszej implementacji.
