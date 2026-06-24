import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OllamaBackend,
  OpenAICompatibleBackend,
  type LLMOptions,
} from "./llm-backend.js";

// ─── Helpers ──────────────────────────────────────────────────────

function installFetchMock(fn: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = fn;
  return () => { globalThis.fetch = orig; };
}

// ─── OllamaBackend tests ─────────────────────────────────────────

describe("OllamaBackend", () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    restore = installFetchMock(async () => {
      throw new TypeError("fetch not mocked");
    });
  });

  afterEach(() => { restore?.(); });

  it("sends correct prompt format and returns response", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (url: string, init?: RequestInit) => {
        expect(url).toBe("http://localhost:11434/api/generate");
        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.model).toBe("qwen2.5:7b");
        expect(body.prompt).toBe("Describe z-fighting.");
        expect(body.stream).toBe(false);
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: "Z-fighting occurs when..." }),
          text: async () => '{"response":"Z-fighting occurs when..."}',
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OllamaBackend({
      url: "http://localhost:11434",
      model: "qwen2.5:7b",
    });

    const result = await backend.complete("Describe z-fighting.");

    expect(result).toBe("Z-fighting occurs when...");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("uses custom model from opts", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (url: string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.model).toBe("llama3");
        expect(body.options?.num_predict).toBe(2048);
        return {
          ok: true, status: 200,
          json: async () => ({ response: "ok" }),
          text: async () => '{"response":"ok"}',
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OllamaBackend({ url: "http://localhost:11434" });
    await backend.complete("hi", { model: "llama3", maxTokens: 2048 });
  });

  it("throws on HTTP error", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async () => ({
        ok: false, status: 500,
        text: async () => '{"error":"OOM"}',
      } as Response),
    );
    globalThis.fetch = mockFn;

    const backend = new OllamaBackend({ url: "http://localhost:11434" });
    await expect(backend.complete("hi")).rejects.toThrow("Ollama HTTP 500");
  });

  it("retries on TypeError and succeeds on second try", async () => {
    let callCount = 0;
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async () => {
        callCount++;
        if (callCount === 1) throw new TypeError("Network error");
        return {
          ok: true, status: 200,
          json: async () => ({ response: "recovered" }),
          text: async () => '{"response":"recovered"}',
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OllamaBackend({ url: "http://localhost:11434" });
    const result = await backend.complete("hi", { retries: 2 });
    expect(result).toBe("recovered");
    expect(callCount).toBe(2);
  });

  it("strips trailing slashes from URL", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (url: string) => {
        expect(url).toBe("http://localhost:11434/api/generate");
        return {
          ok: true, status: 200,
          json: async () => ({ response: "x" }),
          text: async () => '{"response":"x"}',
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OllamaBackend({ url: "http://localhost:11434/" });
    await backend.complete("hi");
  });
});

// ─── OpenAICompatibleBackend tests ────────────────────────────────

describe("OpenAICompatibleBackend", () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    restore = installFetchMock(async () => {
      throw new TypeError("fetch not mocked");
    });
  });

  afterEach(() => { restore?.(); });

  it("sends correct chat format and returns content", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (url: string, init?: RequestInit) => {
        expect(url).toBe("http://localhost:8080/v1/chat/completions");
        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.model).toBe("gpt-4o-mini");
        expect(body.messages).toEqual([
          { role: "user", content: "Describe z-fighting." },
        ]);
        expect(body.stream).toBe(false);
        return {
          ok: true, status: 200,
          json: async () => ({
            choices: [{ message: { content: "Z-fighting is..." } }],
          }),
          text: async () => JSON.stringify({
            choices: [{ message: { content: "Z-fighting is..." } }],
          }),
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OpenAICompatibleBackend({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });

    const result = await backend.complete("Describe z-fighting.");

    expect(result).toBe("Z-fighting is...");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("includes Authorization header when apiKey provided", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (typeof headers === "string") {
          // unlikely but handle
        } else if (headers && typeof headers === "object" && !Array.isArray(headers)) {
          expect(headers["Authorization"]).toBe("Bearer test-key");
        }
        return {
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OpenAICompatibleBackend({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
    });
    await backend.complete("hi");
  });

  it("works without apiKey", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers && typeof headers === "object" && !Array.isArray(headers)) {
          expect(headers["Authorization"]).toBeUndefined();
        }
        return {
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      },
    );
    globalThis.fetch = mockFn;

    const backend = new OpenAICompatibleBackend({
      baseUrl: "http://localhost:1234",
    });
    await backend.complete("hi");
  });

  it("throws on HTTP error", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async () => ({
        ok: false, status: 401,
        text: async () => '{"error":"Unauthorized"}',
      } as Response),
    );
    globalThis.fetch = mockFn;

    const backend = new OpenAICompatibleBackend({
      baseUrl: "http://localhost:8080",
    });
    await expect(backend.complete("hi")).rejects.toThrow(
      "OpenAI-compatible HTTP 401",
    );
  });

  it("returns empty string when no choices", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async () => ({
        ok: true, status: 200,
        json: async () => ({ choices: [] }),
        text: async () => JSON.stringify({ choices: [] }),
      } as Response),
    );
    globalThis.fetch = mockFn;

    const backend = new OpenAICompatibleBackend({
      baseUrl: "http://localhost:8080",
    });
    const result = await backend.complete("hi");
    expect(result).toBe("");
  });
});
