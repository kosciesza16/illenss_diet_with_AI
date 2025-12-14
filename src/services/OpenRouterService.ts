// ...existing code...
import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';

export type Role = 'system' | 'user' | 'assistant';

export interface OpenRouterMessage {
  role: Role;
  content: string;
}

export type JSONSchema = any;

export type ResponseFormatSpec = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: boolean;
    schema: JSONSchema;
  };
};

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
  responseSchemaRegistry?: Record<string, JSONSchema>;
  rateLimitPolicy?: { maxRequests: number; windowMs: number };
}

export interface Logger {
  info(...args: any[]): void;
  debug(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export type OpenRouterResponse = any;
export type StructuredResult<T = any> = T;
export type StreamChunk = { delta: string; done?: boolean };

// Error classes
export class OpenRouterError extends Error {
  public code: string;
  public status?: number;
  public cause?: any;
  constructor(message: string, code = 'OPENROUTER_ERROR', status?: number, cause?: any) {
    super(message);
    this.name = 'OpenRouterError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export class AuthenticationError extends OpenRouterError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH');
    this.name = 'AuthenticationError';
  }
}

export class NetworkError extends OpenRouterError {
  constructor(message = 'Network error', cause?: any) {
    super(message, 'NETWORK', undefined, cause);
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends OpenRouterError {
  public retryAfter?: number;
  constructor(message = 'Rate limited', retryAfter?: number) {
    super(message, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ResponseFormatError extends OpenRouterError {
  public details: any;
  constructor(message = 'Response format validation failed', details?: any) {
    super(message, 'FORMAT');
    this.name = 'ResponseFormatError';
    this.details = details;
  }
}

export class ValidationError extends OpenRouterError {
  constructor(message = 'Validation error') {
    super(message, 'VALIDATION');
    this.name = 'ValidationError';
  }
}

export class UnsupportedFeatureError extends OpenRouterError {
  constructor(message = 'Feature not supported') {
    super(message, 'UNSUPPORTED');
    this.name = 'UnsupportedFeatureError';
  }
}

export class OpenRouterService {
  public readonly baseUrl: string;
  public defaultModel: string;
  public readonly timeoutMs: number;
  public readonly maxRetries: number;

  private apiKey: string;
  private logger: Logger;
  private responseSchemaRegistry: Record<string, JSONSchema>;
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();
  private systemMessage: string | null = null;
  private isShutdown = false;

  constructor(config: OpenRouterConfig) {
    if (!config || typeof config !== 'object') throw new ValidationError('Config object is required');

    const { apiKey, baseUrl, defaultModel, timeoutMs, maxRetries, logger, responseSchemaRegistry } = config;

    if (!apiKey || typeof apiKey !== 'string') throw new AuthenticationError('apiKey is required');

    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://api.openrouter.ai';
    this.defaultModel = defaultModel || 'tngtech/deepseek-r1t2-chimera:free';
    this.timeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 15000;
    this.maxRetries = typeof maxRetries === 'number' ? maxRetries : 3;
    this.logger = logger || console;
    this.responseSchemaRegistry = responseSchemaRegistry || {};

    this.ajv = new Ajv({ strict: false });

    // Precompile validators for any provided schemas
    for (const [name, schema] of Object.entries(this.responseSchemaRegistry)) {
      try {
        const v = this.ajv.compile(schema);
        this.validators.set(name, v);
      } catch (e) {
        this.logger.warn('Invalid schema in registry, skipping', name, e);
      }
    }
  }

  // Public API
  public setSystemMessage(message: string): void {
    if (!message || typeof message !== 'string') throw new ValidationError('system message must be a non-empty string');
    this.systemMessage = message;
  }

  public setParams(_params: Record<string, any>): void {
    // For now we support passing params per-call; this method can be used to set global defaults
    // Implement as needed (merge semantics) — placeholder to satisfy API in plan
    this.logger.debug('setParams called - implement merge as needed');
  }

  public async sendMessage(
    messages: OpenRouterMessage[],
    opts?: { model?: string; params?: Record<string, any>; responseFormat?: ResponseFormatSpec; timeoutMs?: number }
  ): Promise<OpenRouterResponse> {
    if (this.isShutdown) throw new OpenRouterError('Service is shutdown');
    if (!Array.isArray(messages) || messages.length === 0) throw new ValidationError('messages must be a non-empty array');

    const payload = this.buildPayload(messages, opts);

    const attempt = async () => {
      const controller = new AbortController();
      const tmo = opts?.timeoutMs ?? this.timeoutMs;
      const timeout = setTimeout(() => controller.abort(), tmo);
      try {
        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return await this.handleOpenRouterResponse(res, payload);
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') throw new NetworkError('Request timeout', err);
        throw new NetworkError('Network request failed', err);
      }
    };

    return this.retryWithBackoff(attempt, this.maxRetries);
  }

  public async sendStructuredMessage<T = any>(
    messages: OpenRouterMessage[],
    responseFormat: ResponseFormatSpec,
    opts?: { model?: string; params?: Record<string, any> }
  ): Promise<StructuredResult<T>> {
    if (!responseFormat || responseFormat.type !== 'json_schema') throw new ValidationError('responseFormat must be json_schema');

    const res = await this.sendMessage(messages, { ...opts, responseFormat });

    // Validate using AJV
    const schemaName = responseFormat.json_schema.name;
    const schema = responseFormat.json_schema.schema;

    let validator = this.validators.get(schemaName);
    if (!validator) {
      try {
        validator = this.ajv.compile(schema);
        this.validators.set(schemaName, validator);
      } catch (e) {
        throw new ValidationError('Invalid response schema provided');
      }
    }

    const payload = res?.output ?? res;

    const valid = validator(payload);
    if (!valid) {
      throw new ResponseFormatError('Response did not match schema', validator.errors);
    }

    return payload as T;
  }

  public streamResponses(_messages: OpenRouterMessage[], _opts?: { model?: string; params?: Record<string, any> }): AsyncIterable<StreamChunk> {
    throw new UnsupportedFeatureError('Streaming not implemented in this step');
  }

  public async healthCheck(): Promise<{ ok: boolean; latMs?: number; details?: any }> {
    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.buildHeaders() });
      const lat = Date.now() - start;
      if (res.status === 401) throw new AuthenticationError('Invalid API key');
      return { ok: res.ok, latMs: lat, details: { status: res.status } };
    } catch (err: any) {
      this.logger.error('Healthcheck failed', err);
      return { ok: false, details: { message: err.message } };
    }
  }

  public async shutdown(): Promise<void> {
    this.isShutdown = true;
    // future: cancel pending requests, cleanup resources
    this.logger.info('OpenRouterService shutdown');
  }

  // Private helpers
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
  }

  private buildPayload(messages: OpenRouterMessage[], opts?: { model?: string; params?: Record<string, any>; responseFormat?: ResponseFormatSpec }): any {
    if (!Array.isArray(messages) || messages.length === 0) throw new ValidationError('messages must be a non-empty array');

    const model = opts?.model || this.defaultModel;

    const combinedMessages: OpenRouterMessage[] = [];
    if (this.systemMessage) combinedMessages.push({ role: 'system', content: this.systemMessage });
    combinedMessages.push(...messages);

    const payload: any = {
      model,
      messages: combinedMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (opts?.params) payload.params = opts.params;
    if (opts?.responseFormat) payload.response_format = opts.responseFormat;

    return payload;
  }

  private async handleOpenRouterResponse(res: Response, sentPayload?: any): Promise<any> {
    // Normalize non-2xx codes
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new AuthenticationError('Invalid API key');
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10) || undefined;
        throw new RateLimitError('Rate limited by OpenRouter', retryAfter);
      }
      throw new OpenRouterError(`OpenRouter returned ${res.status}: ${text}`, 'OPENROUTER_HTTP', res.status);
    }

    // Parse JSON
    let data: any;
    try {
      data = await res.json();
    } catch (e) {
      throw new OpenRouterError('Invalid JSON response from OpenRouter', 'INVALID_JSON', res.status, e);
    }

    // If response_format requested, prefer validated field
    if (sentPayload?.response_format) {
      // OpenRouter may include structured output in different shapes; try common paths
      const candidate = data?.output ?? data?.choices?.[0]?.message ?? data;
      return candidate;
    }

    return data;
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    let attempt = 0;
    const base = 300; // ms
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;
        const retriable = this.isRetriableError(err);
        if (!retriable || attempt > retries) {
          throw err;
        }
        const jitter = Math.random() * 100;
        const wait = Math.min(2000, base * Math.pow(2, attempt)) + jitter;
        this.logger.warn('Retrying after error', { attempt, wait, err: err.message });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private isRetriableError(err: any): boolean {
    if (!err) return false;
    if (err instanceof RateLimitError) return true;
    if (err instanceof NetworkError) return true;
    // other transient status
    return false;
  }

  private rateLimitHandler(_headers: Headers): void {
    // placeholder: extract rate-limit and update local state if needed
  }

  private parseStreamingChunk(_chunk: string): StreamChunk {
    // placeholder for streaming implementation
    return { delta: _chunk };
  }

  private logAndMaskSensitiveData(obj: any): void {
    try {
      const copy = JSON.parse(JSON.stringify(obj));
      if (copy?.headers?.Authorization) copy.headers.Authorization = 'Bearer [REDACTED]';
      this.logger.debug('payload', copy);
    } catch (e) {
      this.logger.debug('logAndMaskSensitiveData failed', e);
    }
  }
}

export default OpenRouterService;
// ...existing code...
