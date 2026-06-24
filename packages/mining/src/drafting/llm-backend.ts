/**
 * LLM Backend abstraction for Problem Mining Pipeline.
 *
 * Design: only expose `complete(prompt, opts)` — no function calling,
 * no OpenAI-specific APIs. Keeps both Ollama and any OpenAI-compatible
 * endpoint usable with a single interface.
 */

export interface LLMOptions {
  /** Model name (e.g. "qwen2.5:7b", "gpt-4o-mini") */
  model?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature 0..2, higher = more creative */
  temperature?: number;
  /** Timeout in ms (default 60_000) */
  timeoutMs?: number;
  /** Number of retry attempts on transient failure (default 2) */
  retries?: number;
}

export interface LLMBackend {
  /**
   * Send a prompt to the LLM and return the raw text response.
   * Throws on persistent failure after all retries exhausted.
   */
  complete(prompt: string, opts?: LLMOptions): Promise<string>;
}

// ─── OllamaBackend (default, offline-capable) ─────────────────────

export interface OllamaConfig {
  url: string;
  model?: string;
}

export class OllamaBackend implements LLMBackend {
  private readonly url: string;
  private readonly model: string;

  constructor(config: OllamaConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.model = config.model ?? "qwen2.5:7b";
  }

  async complete(
    prompt: string,
    opts: LLMOptions = {},
  ): Promise<string> {
    const {
      model = this.model,
      maxTokens = 4096,
      temperature = 0.2,
      timeoutMs = 120_000,
      retries = 2,
    } = opts;

    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(`${this.url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(
            `Ollama HTTP ${res.status}: ${errBody.slice(0, 500)}`,
          );
        }

        const json = (await res.json()) as { response: string };
        return json.response ?? "";
      } catch (err) {
        lastErr = err;
        // Retry on network errors, timeouts, aborts
        if (
          err instanceof TypeError ||
          (err as Error).name === "AbortError" ||
          (err as Error).message.includes("ECONNREFUSED")
        ) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `OllamaBackend failed after ${retries + 1} attempts: ${lastErr}`,
    );
  }
}

// ─── OpenAICompatibleBackend (fallback) ───────────────────────────

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export class OpenAICompatibleBackend implements LLMBackend {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: OpenAICompatibleConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
  }

  async complete(
    prompt: string,
    opts: LLMOptions = {},
  ): Promise<string> {
    const {
      model = this.model,
      maxTokens = 4096,
      temperature = 0.2,
      timeoutMs = 60_000,
      retries = 2,
    } = opts;

    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(
            `OpenAI-compatible HTTP ${res.status}: ${errBody.slice(0, 500)}`,
          );
        }

        const json = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        return json.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        lastErr = err;
        if (
          err instanceof TypeError ||
          (err as Error).name === "AbortError"
        ) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `OpenAICompatibleBackend failed after ${retries + 1} attempts: ${lastErr}`,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
