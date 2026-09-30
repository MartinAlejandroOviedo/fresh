/// <reference path="./lib/fresh.d.ts" />

/**
 * AI Inline Completion (Ghost Text)
 *
 * Provides Copilot-style inline code completions rendered as semi-transparent
 * "ghost text" at the cursor position. Triggered on cursor movement or text
 * insertion (debounced), and shown after the current line up to the cursor.
 *
 * Requirements:
 *   - An LLM server reachable via HTTP(S) (e.g. Ollama, LM Studio, or any
 *     OpenAI-compatible API). `curl` must be on PATH.
 *   - `plugins.ai_completion.enabled = true` in config.json.
 *
 * Keybindings (add to the `keybindings` array in config.json):
 *   [
 *     {
 *       "key": "Tab",
 *       "modifiers": ["ctrl"],
 *       "action": "ai_completion_accept",
 *       "args": {},
 *       "when": "normal"
 *     },
 *     {
 *       "key": "Escape",
 *       "modifiers": [],
 *       "action": "ai_completion_dismiss",
 *       "args": {},
 *       "when": "normal"
 *     },
 *     {
 *       "key": "\\",
 *       "modifiers": ["ctrl"],
 *       "action": "ai_completion_trigger",
 *       "args": {},
 *       "when": "normal"
 *     }
 *   ]
 *
 * The `action` strings above (`ai_completion_accept`, `ai_completion_dismiss`,
 * `ai_completion_trigger`) are unknown to the built-in Action enum, so the
 * keybinding system treats them as PluginAction dispatches and routes them to
 * the handlers registered below.
 */

const editor = getEditor();

import { WidgetPanel, col, list, textInput, flexSpacer, hintBar, dropdown, parseHintString } from "./lib/widgets.ts";

// =============================================================================
// Config
// =============================================================================

const cfg_enabled = editor.defineConfigBoolean("enabled", {
  default: false,
  description: "Enable AI inline code completions (ghost text)",
});

const cfg_endpoint = editor.defineConfigString("endpoint", {
  default: "http://localhost:11434/api/generate",
  description: "LLM API endpoint URL (POST). Ollama default: http://localhost:11434/api/generate",
});

const cfg_model = editor.defineConfigString("model", {
  default: "deepseek-coder",
  description: "LLM model name to send in the request body",
});

const cfg_apiKey = editor.defineConfigString("apiKey", {
  default: "",
  description: "Optional Bearer token for authenticated endpoints (OpenAI, etc.). Leave empty for local/Ollama.",
});

const cfg_apiFormat = editor.defineConfigEnum("apiFormat", {
  values: ["ollama", "openai", "nvidia"] as const,
  default: "openai",
  description:
    "Response format: 'openai' (choices[0]...), 'nvidia' (alias OpenAI-compatible) or 'ollama' (response field)",
});

const cfg_maxTokens = editor.defineConfigInteger("maxTokens", {
  default: 128,
  description: "Maximum tokens to generate in each completion",
  minimum: 1,
  maximum: 4096,
});

const cfg_temperature = editor.defineConfigNumber("temperature", {
  default: 0.1,
  description: "Sampling temperature (0.0 = deterministic)",
  minimum: 0.0,
  maximum: 2.0,
});

const cfg_debounceMs = editor.defineConfigInteger("debounceMs", {
  default: 500,
  description: "Milliseconds to wait after cursor movement / typing before requesting a completion",
  minimum: 50,
  maximum: 5000,
});

const cfg_maxContextLines = editor.defineConfigInteger("maxContextLines", {
  default: 20,
  description: "Number of lines before the cursor to send as context to the LLM",
  minimum: 1,
  maximum: 100,
});

const cfg_chatSystemPrompt = editor.defineConfigString("chatSystemPrompt", {
  default:
    "You are a helpful code assistant. You can discuss code, answer questions, and help with editing. " +
    "When writing code, use Markdown formatting with code blocks. Be concise. " +
    "If the user asks about the code they have open, you can see their selected code or current file context.",
  description: "System prompt used for the AI chat panel",
});

const cfg_chatMaxHistory = editor.defineConfigInteger("chatMaxHistory", {
  default: 50,
  description: "Maximum number of message pairs to retain in the chat conversation history",
  minimum: 5,
  maximum: 500,
});

const cfg_chatIncludeContext = editor.defineConfigBoolean("chatIncludeContext", {
  default: true,
  description: "When true, includes the current selection (or current file) as context in chat requests",
});

const cfg_autoOpenChat = editor.defineConfigBoolean("autoOpenChat", {
  default: true,
  description: "Open the AI chat panel automatically when the editor starts",
});

const cfg_chatMaxCtxLines = editor.defineConfigInteger("chatMaxCtxLines", {
  default: 40,
  description: "Number of lines of file context to include in chat requests (centered around cursor/selection)",
  minimum: 5,
  maximum: 200,
});

// =============================================================================
// Preset provider configurations (simple mode)
// =============================================================================

interface ProviderPreset {
  endpoint: string;
  model: string;
  apiFormat: "ollama" | "openai";
  temperature: number;
  maxTokens: number;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiFormat: "openai",
    temperature: 0.7,
    maxTokens: 1024,
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta/llama-3.1-405b-instruct",
    apiFormat: "openai",
    temperature: 0.7,
    maxTokens: 1024,
  },
  nvidia: {
    // NVIDIA NIM free developer tier (build.nvidia.com). Model IDs are
    // namespaced `org/model`. The chat panel's model dropdown lists the
    // catalog live; note that NOT every catalog id is actually deployed for
    // a given account (most return 404 "not found for account"), so the
    // dropdown is best used with probing. This default is a model verified
    // to respond for the developer-tier account.
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "deepseek-ai/deepseek-v4-pro-0813",
    apiFormat: "openai",
    temperature: 0.7,
    maxTokens: 1024,
  },
  ollama: {
    endpoint: "http://localhost:11434/api/chat",
    model: "deepseek-coder",
    apiFormat: "ollama",
    temperature: 0.7,
    maxTokens: 1024,
  },
  // Manual configuration: fill endpoint/model/apiKey yourself (mode: advanced).
  custom: {
    endpoint: "",
    model: "",
    apiFormat: "openai",
    temperature: 0.7,
    maxTokens: 1024,
  },
};

// Two styles of configuration:
//   simple   — pick `provider` + set `apiKey`. endpoint/model/format/
//              temperature/tokens are resolved from the preset. Recommended.
//   advanced — resolve from the preset, but let the user override
//              endpoint/model/apiFormat/temperature/maxTokens.
const cfg_mode = editor.defineConfigEnum("mode", {
  values: ["simple", "advanced"] as const,
  default: "simple",
  description:
    "Modo simple: elige proveedor y escribe la API key. " +
    "Modo avanzado: permite sobrescribir endpoint, modelo, formato, temperatura y tokens.",
});

const cfg_provider = editor.defineConfigEnum("provider", {
  values: ["openai", "openrouter", "nvidia", "ollama", "custom"] as const,
  default: "nvidia",
  description:
    "Proveedor de LLM preconfigurado (modo simple). " +
    "'custom' requiere endpoint/modelo manuales en modo avanzado.",
});

// =============================================================================
// State
// =============================================================================

interface AiConfig {
  enabled: boolean;
  mode: "simple" | "advanced";
  provider: "openai" | "openrouter" | "nvidia" | "ollama" | "custom";
  endpoint: string;
  model: string;
  apiKey: string;
  apiKeys: Record<string, string>;
  apiFormat: "ollama" | "openai";
  maxTokens: number;
  temperature: number;
  debounceMs: number;
  maxContextLines: number;
  chatSystemPrompt: string;
  chatMaxHistory: number;
  chatIncludeContext: boolean;
  autoOpenChat: boolean;
  chatMaxCtxLines: number;
}

function getConfig(): AiConfig {
  const cfg = (editor.getPluginConfig() ?? {}) as Record<string, unknown>;
  const mode = ((cfg.mode as string) ?? "simple") as "simple" | "advanced";
  const provider = ((cfg.provider as string) ?? "nvidia") as
    | "openai"
    | "openrouter"
    | "nvidia"
    | "ollama"
    | "custom";

  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.nvidia;
  const advanced = mode === "advanced";

  // Simple mode resolves everything from the provider preset; the user only
  // picks `provider` and writes `apiKey`. In advanced mode the preset is the
  // base but each value can be overridden, so a single provider+key drives
  // both inline completions and the chat panel.
  const endpoint = advanced ? ((cfg.endpoint as string) || preset.endpoint) : preset.endpoint;
  // The model is selectable in BOTH modes: in simple mode it overrides the
  // provider's default (e.g. swap NVIDIA's default model), in advanced mode
  // it behaves the same way. Leave it unset to use the preset default.
  const model = (cfg.model as string) || preset.model;
  // "nvidia" is an accepted alias for the OpenAI-compatible response format
  // (NVIDIA's API speaks OpenAI's chat-completions protocol), so it is
  // normalized to "openai" here rather than falling through to the Ollama
  // branch and silently breaking the parse.
  const rawApiFormat = (advanced ? cfg.apiFormat : undefined) as "openai" | "ollama" | "nvidia" | undefined;
  const apiFormat: "openai" | "ollama" =
    (rawApiFormat === "nvidia" ? "openai" : rawApiFormat) ?? preset.apiFormat;
  const temperature = advanced
    ? ((cfg.temperature as number) ?? preset.temperature)
    : preset.temperature;
  const maxTokens = advanced
    ? ((cfg.maxTokens as number) ?? preset.maxTokens)
    : preset.maxTokens;

  return {
    enabled: cfg.enabled === true,
    mode,
    provider,
    endpoint,
    model,
    apiKey: (cfg.apiKey as string) ?? "",
    apiKeys: ((cfg.apiKeys as Record<string, string>) ?? {}),
    apiFormat,
    maxTokens,
    temperature,
    debounceMs: (cfg.debounceMs as number) ?? 500,
    maxContextLines: (cfg.maxContextLines as number) ?? 20,
    chatSystemPrompt: (cfg.chatSystemPrompt as string) ?? "",
    chatMaxHistory: (cfg.chatMaxHistory as number) ?? 50,
    chatIncludeContext: cfg.chatIncludeContext !== false,
    autoOpenChat: cfg.autoOpenChat !== false,
    chatMaxCtxLines: (cfg.chatMaxCtxLines as number) ?? 40,
  };
}

const VTEXT_ID = "ai_completion_ghost";

let ghostText: string | null = null;
let ghostBufferId: number = 0;
let ghostPosition: number = 0;
let pendingProcess: ProcessHandle<SpawnResult> | null = null;
let debounceTimerId: number | null = null;
let lastRequestId: number = 0;

// =============================================================================
// Ghost text rendering
// =============================================================================

function clearGhost(): void {
  if (ghostText !== null && ghostBufferId > 0) {
    editor.removeVirtualText(ghostBufferId, VTEXT_ID);
  }
  ghostText = null;
  ghostBufferId = 0;
  ghostPosition = 0;
}

function renderGhost(bufferId: number, position: number, text: string): void {
  if (!text || text.length === 0) {
    clearGhost();
    return;
  }

  clearGhost();
  ghostText = text;
  ghostBufferId = bufferId;
  ghostPosition = position;

  editor.addVirtualTextStyled(
    bufferId,
    VTEXT_ID,
    position,
    text,
    {
      fg: [120, 120, 130],
      italic: true,
    },
    true,
  );
}

// =============================================================================
// LLM interaction
// =============================================================================

function buildRequestBody(cfg: AiConfig, prompt: string): string {
  if (cfg.apiFormat === "openai") {
    const body = {
      model: cfg.model,
      messages: [
        {
          role: "system",
          content:
            "You are an AI code completion assistant. Predict what the user wants to type next. Output ONLY the completion text, nothing else. If no completion is likely, output an empty string.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      stream: false,
    };
    return JSON.stringify(body);
  } else {
    const body = {
      model: cfg.model,
      prompt:
        "You are an AI code completion assistant. Predict what the user wants to type next. Output ONLY the completion text, nothing else. If no completion is likely, output an empty string.\n\n" +
        prompt,
      stream: false,
      options: {
        temperature: cfg.temperature,
        num_predict: cfg.maxTokens,
      },
    };
    return JSON.stringify(body);
  }
}

function parseCompletion(cfg: AiConfig, stdout: string): string | null {
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;

    if (cfg.apiFormat === "openai") {
      const choices = data.choices as Array<Record<string, unknown>> | undefined;
      if (choices && choices.length > 0) {
        // Legacy completions API returns `text`; the chat-completions API
        // (OpenAI-compatible endpoints like NVIDIA/OpenRouter) returns
        // `message.content`. Accept either so ghost text works with both.
        const choice = choices[0];
        return ((choice.text as string) ?? (choice.message as { content?: string } | undefined)?.content) ?? null;
      }
      return null;
    } else {
      return (data.response as string) ?? null;
    }
  } catch {
    editor.warn(editor.t("warn.parse_error") + ": " + stdout.slice(0, 200));
    return null;
  }
}

async function fetchCompletion(
  cfg: AiConfig,
  bodyJson: string,
  requestId: number,
): Promise<string | null> {
  // Write the JSON body to a temp file so we don't hit command-line length
  // limits, especially on Windows.
  const tmpFile = editor.pathJoin(editor.getTempDir(), "ai_completion_request.json");
  if (!editor.writeFile(tmpFile, bodyJson)) {
    editor.warn(editor.t("warn.write_failed"));
    return null;
  }

  const curlArgs: string[] = [
    "-s",
    "-X",
    "POST",
    cfg.endpoint,
    "-H",
    "Content-Type: application/json",
    "-d",
    "@" + tmpFile,
    "--max-time",
    "30",
  ];

  if (cfg.apiKey) {
    curlArgs.push("-H", "Authorization: Bearer " + cfg.apiKey);
  }

  try {
    pendingProcess = editor.spawnProcess("curl", curlArgs, editor.getCwd());
    const result = await pendingProcess;

    // If a newer request superseded this one, discard the result.
    if (requestId !== lastRequestId) {
      pendingProcess = null;
      return null;
    }

    pendingProcess = null;

    if (result.exit_code !== 0) {
      editor.warn(
        editor.t("warn.request_failed") +
          " (exit " + result.exit_code + "): " +
          (result.stderr || result.stdout || "").slice(0, 200),
      );
      return null;
    }

    return parseCompletion(cfg, result.stdout);
  } catch (e) {
    pendingProcess = null;
    editor.warn("AI Completion: error: " + String(e));
    return null;
  }
}

// =============================================================================
// Chat LLM interaction
//
// Supports two chat endpoint shapes:
// 1. OpenAI-compatible /chat/completions — uses messages[] array
// 2. Ollama /api/chat — uses messages[] array with role/content
//
// Both formats are handled by the same request builder; the response parser
// detects which shape came back and extracts the assistant's text.
// =============================================================================

async function fetchChatCompletion(
  cfg: AiConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const chatEndpoint = cfg.endpoint;
  const chatModel = currentChatModel();
  const chatApiKey = cfg.apiKey;
  const chatMaxTokens = cfg.maxTokens;
  const chatTemperature = cfg.temperature;

  // Determine if we're talking to an OpenAI-compatible endpoint.
  // The existing `apiFormat` config tells us how to parse *completions*
  // responses. For chat we infer from the endpoint URL.
  const isChatCompletions = chatEndpoint.includes("/chat/completions");
  let body: unknown;

  if (isChatCompletions) {
    body = {
      model: chatModel,
      messages: messages,
      max_tokens: chatMaxTokens,
      temperature: chatTemperature,
      stream: false,
    };
  } else if (cfg.apiFormat === "openai") {
    // Treat as OpenAI-compatible even if the URL shape isn't exact
    body = {
      model: chatModel,
      messages: messages,
      max_tokens: chatMaxTokens,
      temperature: chatTemperature,
      stream: false,
    };
  } else {
    // Ollama /api/chat format
    body = {
      model: chatModel,
      messages: messages,
      stream: false,
      options: {
        temperature: chatTemperature,
        num_predict: chatMaxTokens,
      },
    };
  }

  const bodyJson = JSON.stringify(body);

  // Write body to temp file to avoid command-line length limits.
  const tmpFile = editor.pathJoin(editor.getTempDir(), "ai_chat_request.json");
  if (!editor.writeFile(tmpFile, bodyJson)) {
    editor.warn(editor.t("warn.write_failed"));
    return null;
  }

  const curlArgs: string[] = [
    "-s",
    "-X",
    "POST",
    chatEndpoint,
    "-H",
    "Content-Type: application/json",
    "-d",
    "@" + tmpFile,
    "--max-time",
    "60",
  ];

  if (chatApiKey) {
    curlArgs.push("-H", "Authorization: Bearer " + chatApiKey);
  }

  pendingProcess = editor.spawnProcess("curl", curlArgs, editor.getCwd());
  try {
    const result = await pendingProcess;

    pendingProcess = null;

    if (result.exit_code !== 0) {
      editor.warn(
        editor.t("warn.request_failed") +
          " (exit " + result.exit_code + "): " +
          (result.stderr || result.stdout || "").slice(0, 200),
      );
      return null;
    }

    return parseChatResponse(result.stdout);
  } catch (e) {
    pendingProcess = null;
    editor.warn("AI Chat: error: " + String(e));
    return null;
  }
}

function parseChatResponse(stdout: string): string | null {
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;

    // OpenAI /chat/completions format: choices[0].message.content
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices.length > 0) {
      // OpenAI chat format
      const message = choices[0].message as Record<string, unknown> | undefined;
      if (message && typeof message.content === "string") {
        return message.content;
      }
      // OpenAI completions format (choices[0].text)
      if (typeof choices[0].text === "string") {
        return choices[0].text;
      }
    }

    // Ollama /api/chat format: message.content
    const msg = data.message as Record<string, unknown> | undefined;
    if (msg && typeof msg.content === "string") {
      return msg.content;
    }

    // Ollama /api/generate format: response (single-line) or full text
    if (typeof data.response === "string") {
      return data.response;
    }

    return null;
  } catch {
    editor.warn(editor.t("warn.parse_error") + ": " + stdout.slice(0, 200));
    return null;
  }
}

// =============================================================================
// Chat buffer management
// =============================================================================

const CHAT_BUFFER_NAME = "AI Chat";
let chatBufferId: number = 0;
let chatMessages: Array<{ role: string; content: string }> = [];

function findChatBuffer(): number {
  const buffers = editor.listBuffers();
  for (const buf of buffers) {
    if (buf.is_virtual && buf.name === CHAT_BUFFER_NAME) {
      return buf.id;
    }
  }
  return 0;
}

async function openChatBuffer(): Promise<number> {
  // Check if chat buffer already exists anywhere
  const buffers = editor.listBuffers();
  for (const buf of buffers) {
    if (buf.is_virtual && buf.name === CHAT_BUFFER_NAME) {
      chatBufferId = buf.id;
      editor.showBuffer(buf.id);
      await editor.flush();

      // Focus the split that shows the chat buffer
      const splits = editor.listSplits();
      for (const split of splits) {
        if (split.bufferId === chatBufferId) {
          editor.focusSplit(split.splitId);
          break;
        }
      }
      return chatBufferId;
    }
  }

  // No existing chat buffer — split the current pane and create one
  const result = await editor.createVirtualBufferInSplit({
    name: CHAT_BUFFER_NAME,
    mode: "ai_chat",
    readOnly: true,
    showLineNumbers: false,
    showCursors: false,
    editingDisabled: true,
    direction: "vertical",
    ratio: 0.3,
    before: false,
  });

  chatBufferId = result.bufferId;

  // The new split becomes the active one; show the chat buffer
  editor.showBuffer(result.bufferId);
  await editor.flush();

  return result.bufferId;
}

// The chat panel is rendered as a widget panel mounted inside the virtual
// "AI Chat" buffer: a scrollable transcript `list` on top and a single-line
// `textInput` pinned to the bottom of the column (the input lives INSIDE
// the chat column, not in the editor's global prompt line).

const CHAT_TRANSCRIPT_KEY = "chat_log";
const CHAT_INPUT_KEY = "chat_input";
const CHAT_MODEL_KEY = "chat_model";
const CHAT_PROVIDER_KEY = "chat_provider";
const CHAT_PANEL_ID = 771;
let chatPanel: WidgetPanel | null = null;
let chatInputText = "";
let chatFocusedWidget = CHAT_INPUT_KEY;
let chatModelsLoading = false;

// Provider + model selectors live in the chat panel and are session-scoped
// (they reset to the config's values when the panel reopens).
const PROVIDER_OPTIONS = ["openai", "openrouter", "nvidia", "ollama", "custom"];

// Builder's `nimType:nim_type_preview` / "Free Endpoint" filter is not
// exposed by NVIDIA's OpenAI-compatible `/v1/models` response. Keep the
// current Builder catalog explicitly so the NVIDIA picker matches the UI.
// These are endpoint IDs, not display names.
const NVIDIA_FREE_MODELS = [
  "moonshotai/kimi-k3",
  "deepseek-ai/deepseek-v4-pro-0813",
  "deepseek-ai/deepseek-v4-flash-0731",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "meta/muse-glimmer-30b",
  "nvidia/riva-translate-4b-instruct-v2",
  "nvidia/ising-calibration-1.5-31b",
  "nvidia/nemotron-3-embed-1b",
  "poolside/laguna-xs-2.1",
  "minimaxai/minimax-m3",
  "google/diffusiongemma-26b-a4b-it",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-content-safety",
  "nvidia/cosmos3-nano",
  "nvidia/cosmos3-nano-reasoner",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/ai-synthetic-video-detector",
  "nvidia/active-speaker-detection",
  "nvidia/ising-calibration-1-35b-a3b",
  "google/gemma-4-31b-it",
  "nvidia/nemotron-voicechat",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/cosmos-transfer2.5-2b",
  "nvidia/riva-translate-4b-instruct-v1.1",
];
let selectedProvider: string | null = null;
let chatModelList: string[] = [];
let selectedModel: string | null = null;

function chatProvider(): string {
  return selectedProvider ?? getConfig().provider;
}

function currentChatModel(): string {
  if (selectedModel) return selectedModel;
  const cfg = getConfig();
  const provider = chatProvider();
  // The configured model belongs to the configured provider. After an
  // in-panel provider switch, start from that provider's own preset instead
  // of carrying NVIDIA's model id into OpenAI/OpenRouter/Ollama.
  if (provider === cfg.provider) return cfg.model;
  return (PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.nvidia).model;
}

async function refreshChatModels(provider: string): Promise<void> {
  const requestedProvider = provider;
  chatModelsLoading = true;
  renderChat();

  const pcfg = chatProviderConfig();
  const models = await fetchAvailableModels(requestedProvider, pcfg.apiKey);
  // Ignore a stale response when the user switched providers while the
  // request was in flight.
  if (chatProvider() !== requestedProvider) return;

  const configured = currentChatModel();
  chatModelList = Array.from(new Set(models)).sort();
  if (configured && !chatModelList.includes(configured)) {
    chatModelList.unshift(configured);
  }
  chatModelsLoading = false;
  renderChat();
}

// The effective provider settings the chat uses. Simple mode resolves
// endpoint/model/apiFormat/temperature/maxTokens from the selected provider's
// preset; advanced mode still allows overrides. The API key is the config's
// global key — the user supplies the right one for whichever provider they
// pick (NVIDIA's key only authenticates NVIDIA's catalog).
function chatProviderConfig(): AiConfig {
  const cfg = getConfig();
  const provider = chatProvider();
  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.nvidia;
  const advanced = cfg.mode === "advanced";
  const endpoint = advanced ? ((cfg.endpoint as string) || preset.endpoint) : preset.endpoint;
  const model = currentChatModel() || preset.model;
  const rawApiFormat = (advanced ? cfg.apiFormat : undefined) as "openai" | "ollama" | "nvidia" | undefined;
  const apiFormat: "openai" | "ollama" =
    (rawApiFormat === "nvidia" ? "openai" : rawApiFormat) ?? preset.apiFormat;
  return {
    ...cfg,
    provider: provider as AiConfig["provider"],
    endpoint,
    model,
    apiFormat,
    // Per-provider key wins; fall back to the global `apiKey`.
    apiKey: (cfg.apiKeys[provider] || cfg.apiKey) ?? "",
    temperature: advanced ? cfg.temperature : preset.temperature,
    maxTokens: advanced ? cfg.maxTokens : preset.maxTokens,
  };
}

// Models a provider serves, as a list of IDs. NVIDIA's OpenAI-compatible
// catalog does not expose the Builder UI's `nim_type_preview` / pricing
// metadata, so NVIDIA uses the curated Free Endpoint list above. Other
// providers use their `/models` discovery endpoint.
async function fetchAvailableModels(provider: string, apiKey: string): Promise<string[]> {
  // NVIDIA's public inference catalog omits the Builder metadata needed to
  // reproduce its Free Endpoint filter, so use the curated Builder list.
  if (provider === "nvidia") return [...NVIDIA_FREE_MODELS];

  let url = "";
  if (provider === "openai") url = "https://api.openai.com/v1/models";
  else if (provider === "openrouter") url = "https://openrouter.ai/api/v1/models";
  else if (provider === "ollama") url = "http://localhost:11434/api/tags";
  else return [];

  // Cloud providers need the key; without one there's nothing to list (and no
  // point hammering the network). Ollama is local and needs no auth.
  if (provider !== "ollama" && !apiKey) return [];

  const curlArgs: string[] = ["-s", "-X", "GET", url, "--max-time", "15"];
  if (apiKey && provider !== "ollama") {
    curlArgs.push("-H", "Authorization: Bearer " + apiKey);
  }

  try {
    const proc = editor.spawnProcess("curl", curlArgs, editor.getCwd());
    const result = await proc;
    if (result.exit_code !== 0) return [];
    const data = JSON.parse(result.stdout) as Record<string, unknown>;

    // OpenAI-compatible catalogs (including NVIDIA): `{ data: [{ id }] }`.
    // Ollama: `{ models: [{ name }] }`. A top-level array is also accepted
    // defensively for catalog variants.
    const rawList: Array<Record<string, unknown>> = Array.isArray(data)
      ? data
      : ((data.data as Array<Record<string, unknown>>) ?? []);
    let entries = rawList.length > 0
      ? rawList
      : ((data.models as Array<Record<string, unknown>>) ?? []);

    return entries
      .map((m) => String(m.id ?? m.name ?? ""))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function chatRolePrefix(role: string): string {
  if (role === "user") return editor.t("chat.user");
  if (role === "assistant") return editor.t("chat.assistant");
  return editor.t("chat.system");
}

function buildTranscriptEntries(): TextPropertyEntry[] {
  const entries: TextPropertyEntry[] = [];
  // One row per message, prefixed with a role marker so the reader can tell
  // turns apart at a glance. Plain rows — the host applies the panel theme.
  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    entries.push({
      text: chatRolePrefix(msg.role) + " " + msg.content,
    });
  }
  return entries;
}

function buildChatSpec(): WidgetSpec {
  const provider = chatProvider();
  return col(
    dropdown(PROVIDER_OPTIONS, {
      selectedIndex: Math.max(0, PROVIDER_OPTIONS.indexOf(provider)),
      label: editor.t("chat.provider"),
      key: CHAT_PROVIDER_KEY,
    }),
    dropdown(chatModelList, {
      selectedIndex: Math.max(0, chatModelList.indexOf(currentChatModel())),
      label: editor.t("chat.model") + (chatModelsLoading ? "..." : ""),
      key: CHAT_MODEL_KEY,
    }),
    list({
      items: buildTranscriptEntries(),
      itemKeys: chatMessages.map((_, i) => "msg:" + i),
      focusable: false,
      key: CHAT_TRANSCRIPT_KEY,
    }),
    flexSpacer(),
    textInput(chatInputText, {
      focused: true,
      fullWidth: true,
      placeholder: editor.t("chat.input_placeholder"),
      key: CHAT_INPUT_KEY,
    }),
    hintBar(parseHintString(editor.t("chat.hints"))),
  );
}

function renderChat(): void {
  if (chatBufferId === 0) return;
  if (!chatPanel) chatPanel = new WidgetPanel(chatBufferId, CHAT_PANEL_ID);
  chatPanel.set(buildChatSpec());
}

function appendUserMessage(text: string): void {
  chatMessages.push({ role: "user", content: text });
  if (chatMessages.length > 200) {
    chatMessages = chatMessages.slice(chatMessages.length - 200);
  }
}

function appendAssistantMessage(text: string): void {
  chatMessages.push({ role: "assistant", content: text });
  if (chatMessages.length > 200) {
    chatMessages = chatMessages.slice(chatMessages.length - 200);
  }
}

function appendSystemMessage(text: string): void {
  chatMessages.push({ role: "system", content: text });
  if (chatMessages.length > 200) {
    chatMessages = chatMessages.slice(chatMessages.length - 200);
  }
}

function clearChat(): void {
  // Wipe the transcript, but NOT `chatBufferId`: `aiChatOpen` calls this on a
  // freshly-opened panel ("clear any previous conversation") and must keep
  // the handle so the welcome line and the input can still address the
  // panel. Callers that truly want to drop the handle reset `chatBufferId`
  // themselves (`aiChatDismiss`, `aiChatClose`, `buffer_closed`).
  chatMessages = [];
  chatInputText = "";
  renderChat();
}

// Gather code context from the currently active editor buffer.
// Returns a formatted string that can be appended to the chat messages.
async function gatherCodeContext(): Promise<string> {
  const cfg = getConfig();
  if (!cfg.chatIncludeContext) return "";

  const activeBufId = editor.getActiveBufferId();
  if (activeBufId === 0 || activeBufId === chatBufferId) return "";

  const info = editor.getBufferInfo(activeBufId);
  if (!info || info.is_terminal || info.is_virtual || info.editing_disabled) return "";

  const cursor = editor.getPrimaryCursor();
  if (!cursor) return "";

  const cursorPos = cursor.position;
  const cursorLine = cursor.line;

  const bufferLength = info.length;
  if (bufferLength === 0) return "";

  let startPos = 0;
  let endPos = bufferLength;

  if (cursorLine !== null && cursorLine >= 0) {
    const halfContext = Math.floor(cfg.chatMaxCtxLines / 2);
    const startLine = Math.max(0, cursorLine - halfContext);
    const endLine = cursorLine + halfContext;

    const lineStart = await editor.getLineStartPosition(startLine);
    if (lineStart !== null) {
      startPos = lineStart;
    }

    const lineEnd = await editor.getLineEndPosition(endLine);
    if (lineEnd !== null) {
      endPos = lineEnd;
    }
  } else if (cursorPos > 0) {
    startPos = Math.max(0, cursorPos - 2000);
    endPos = Math.min(bufferLength, cursorPos + 2000);
  }

  const contextText = await editor.getBufferText(activeBufId, startPos, endPos);
  if (!contextText || contextText.length === 0) return "";

  const fileExt = editor.pathExtname(info.path);
  const language = fileExt ? fileExt.substring(1) : "unknown";
  const fileName = info.name || info.path || "untitled";

  return (
    "\n\n[Code context from " + fileName + " (" + language + ")]\n" +
    "```" + language + "\n" + contextText + "\n```\n"
  );
}

// =============================================================================
// Chat command handlers
// =============================================================================

async function aiChatOpen(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.enabled) {
    editor.warn(editor.t("warn.disabled"));
    return;
  }

  const bufId = await openChatBuffer();
  if (bufId === 0) {
    editor.warn(editor.t("warn.chat_open_failed"));
    return;
  }

  // Mount immediately with the configured model, then refresh the provider's
  // catalog in the background. Network discovery must never hold up startup.
  chatModelList = [currentChatModel()];
  clearChat();
  appendSystemMessage(editor.t("chat.welcome"));
  renderChat();
  void refreshChatModels(chatProvider());

  // The widget panel's text input gets focus; keep the caret in it so the
  // user can start typing straight away.
  if (chatPanel) chatPanel.setFocusKey(CHAT_INPUT_KEY);
}

async function aiChatSendInternal(): Promise<void> {
  // Resolve the effective provider/model/endpoint (the chat panel's selectors
  // may have changed the provider or model from the config's defaults).
  const cfg = chatProviderConfig();

  // Build the full message list: system + history + user context
  const messages: Array<{ role: string; content: string }> = [];

  if (cfg.chatSystemPrompt) {
    messages.push({ role: "system", content: cfg.chatSystemPrompt });
  }

  // Include recent history (last N messages)
  const historyStart = Math.max(0, chatMessages.length - cfg.chatMaxHistory);
  for (let i = historyStart; i < chatMessages.length; i++) {
    messages.push(chatMessages[i]);
  }

  // Append code context to the most recent user message
  const codeContext = await gatherCodeContext();
  if (codeContext && messages.length > 0) {
    messages[messages.length - 1].content += codeContext;
  }

  // Show a "thinking" indicator in the transcript, then replace it with the
  // real response once the model answers.
  appendAssistantMessage(editor.t("chat.thinking"));
  renderChat();

  const response = await fetchChatCompletion(cfg, messages);

  // The thinking entry is the last one; pop it and push the real answer.
  if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].content === editor.t("chat.thinking")) {
    chatMessages.pop();
  }

  if (response && response.trim().length > 0) {
    appendAssistantMessage(response.trim());
  } else {
    appendSystemMessage(editor.t("chat.no_response"));
  }
  renderChat();

  // Keep the caret in the input so the next message is a keystroke away.
  if (chatPanel) chatPanel.setFocusKey(CHAT_INPUT_KEY);
}

function aiChatAccept(): void {
  // In chat mode, "accept" copies the last assistant message to the
  // active editor buffer at the cursor position.
  const activeBufId = editor.getActiveBufferId();
  if (activeBufId === 0 || activeBufId === chatBufferId) return;

  if (!chatMessages || chatMessages.length === 0) return;

  // Find the last assistant message
  let lastAssistantMsg = "";
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i].role === "assistant") {
      lastAssistantMsg = chatMessages[i].content;
      break;
    }
  }

  if (lastAssistantMsg.length === 0) return;

  editor.insertAtCursor(lastAssistantMsg);
}

function aiChatDismiss(): void {
  // Close the chat buffer if it's active
  if (chatBufferId > 0) {
    clearChat();
    chatBufferId = 0;
  }
}

// Fully remove the chat panel: drop the virtual "AI Chat" buffer and the
// split that holds it, so the View ▸ Chat AI menu row's checkbox unchecks.
// The `buffer_closed` subscription below also resets `chatBufferId`, so
// this only needs to reset the transcript when the buffer was already gone.
async function aiChatClose(): Promise<void> {
  const bufId = findChatBuffer();
  if (bufId === 0) return;

  let splitId = -1;
  const splits = editor.listSplits();
  for (const split of splits) {
    if (split.bufferId === bufId) {
      splitId = split.splitId;
      break;
    }
  }

  if (chatPanel) {
    chatPanel.unmount();
    chatPanel = null;
  }

  // Force: the plugin fills this buffer itself, so it counts as modified.
  editor.closeBuffer(bufId, true);
  await editor.flush();
  if (splitId >= 0) {
    editor.closeSplit(splitId);
    await editor.flush();
  }

  chatBufferId = 0;
  chatMessages = [];
  chatInputText = "";
}

// Submit whatever is currently typed in the chat input: append it to the
// transcript (as a user turn), clear the field, and send it to the model.
function aiChatSubmit(): void {
  const text = chatInputText.trim();
  if (text.length === 0 || chatBufferId === 0) return;
  appendUserMessage(text);
  chatInputText = "";
  if (chatPanel) chatPanel.setValue(CHAT_INPUT_KEY, "");
  renderChat();
  void aiChatSendInternal();
}

function aiChatEnter(): void {
  // The chat mode claims Enter before the widget smart-key path. Hand it
  // back to dropdowns so they can open/confirm normally; only the input
  // interprets Enter as "send".
  if (
    chatPanel &&
    (chatFocusedWidget === CHAT_PROVIDER_KEY || chatFocusedWidget === CHAT_MODEL_KEY)
  ) {
    chatPanel.command({ kind: "activate" });
    return;
  }
  aiChatSubmit();
}

async function requestCompletion(
  bufferId: number,
  cursorPos: number,
  requestId: number,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  // Don't request if we already have a visible ghost text — avoid hammering
  // the model while the user decides to accept or dismiss.
  if (ghostText !== null) return;

  const info = editor.getBufferInfo(bufferId);
  if (!info || info.is_terminal || info.is_virtual || info.editing_disabled) return;

  const bufferLength = info.length;
  if (bufferLength === 0) return;

  // Determine the context window: last N lines before the cursor.
  const cursorLine = editor.getCursorLine();
  if (cursorLine < 0) return;

  const startLine = Math.max(0, cursorLine - cfg.maxContextLines);
  const lineStart = await editor.getLineStartPosition(startLine);
  if (lineStart === null) return;

  // Read the context from `lineStart` to `cursorPos`.
  const contextText = await editor.getBufferText(bufferId, lineStart, cursorPos);
  if (!contextText) return;

  // Infer the language from the file extension for the prompt header.
  const fileExt = editor.pathExtname(info.path);
  const language = fileExt ? fileExt.substring(1) : "unknown";

  // Build the prompt sent to the LLM.
  const prompt =
    "Language: " + language + "\n\nCode:\n" + contextText + "\n\nCompletion:";

  const bodyJson = buildRequestBody(cfg, prompt);
  const completion = await fetchCompletion(cfg, bodyJson, requestId);

  if (requestId !== lastRequestId) return;

  if (completion && completion.length > 0) {
    // Trim leading/trailing whitespace — we want the raw completion, not
    // formatting artifacts. Preserve internal structure.
    const trimmed = completion.trimStart();
    if (trimmed.length > 0) {
      renderGhost(bufferId, cursorPos, trimmed);
      return;
    }
  }

  // No completion available.
  clearGhost();
}

// =============================================================================
// Command handlers
// =============================================================================

function acceptCompletion(): void {
  if (ghostText === null || ghostBufferId === 0) return;

  editor.insertText(ghostBufferId, ghostPosition, ghostText);
  clearGhost();
}

function dismissCompletion(): void {
  clearGhost();
}

function triggerCompletion(): void {
  const cfg = getConfig();
  if (!cfg.enabled) {
    editor.warn(editor.t("warn.disabled"));
    return;
  }

  const bufferId = editor.getActiveBufferId();
  if (bufferId === 0) return;

  const cursorPos = editor.getCursorPosition();
  if (cursorPos === null) return;

  // Cancel any pending request.
  if (pendingProcess !== null) {
    pendingProcess.kill();
    pendingProcess = null;
  }

  clearGhost();
  lastRequestId += 1;
  void requestCompletion(bufferId, cursorPos, lastRequestId);
}

function scheduleCompletion(): void {
  const cfg = getConfig();
  if (!cfg.enabled) {
    clearGhost();
    if (debounceTimerId !== null) {
      editor.clearInterval(debounceTimerId);
      debounceTimerId = null;
    }
    return;
  }

  // Cancel any in-flight request.
  if (pendingProcess !== null) {
    pendingProcess.kill();
    pendingProcess = null;
  }

  // Invalidate any in-flight request so its result is discarded even if
  // the process was killed but its promise still resolves.
  lastRequestId += 1;

  // Clear existing ghost text — the cursor moved, so the old suggestion is stale.
  clearGhost();

  if (debounceTimerId !== null) {
    editor.clearInterval(debounceTimerId);
    debounceTimerId = null;
  }

  debounceTimerId = editor.setTimeout(cfg.debounceMs, "ai_completion_run_debounced");
}

registerHandler("ai_completion_trigger", triggerCompletion);
registerHandler("ai_completion_accept", acceptCompletion);
registerHandler("ai_completion_dismiss", dismissCompletion);

registerHandler("ai_chat_open", () => {
  void aiChatOpen();
});
// View ▸ Chat AI and `%cmd.chat_toggle`: one toggle that either opens the
// chat panel (splitting the current pane into a ~30% right-hand column) or
// removes it again. When a chat buffer already exists, close it — a fresh
// open starts over with a welcome line and the input loop.
registerHandler("ai_chat_toggle", () => {
  if (findChatBuffer() !== 0) {
    void aiChatClose();
  } else {
    void aiChatOpen();
  }
});
registerHandler("ai_chat_send", () => {
  void aiChatSendInternal();
});
// Enter in the chat input — the chat buffer's `ai_chat` mode binds Enter
// here. Reads the typed draft (tracked via the input's `change` event),
// submits it, and clears the field.
registerHandler("ai_chat_submit", () => {
  aiChatEnter();
});
registerHandler("ai_chat_accept", () => {
  aiChatAccept();
});
registerHandler("ai_chat_dismiss", () => {
  aiChatDismiss();
});
// Open the chat panel automatically when the editor finishes starting up
// (the `ready` hook), unless the user opted out with
// `plugins.ai_completion.settings.autoOpenChat = false`. Opening here —
// rather than at module load — mirrors the dashboard plugin: module load
// runs in the startup plugin batch before the user's init.ts, and the
// editor may not be ready to accept a split + prompt yet. If the panel is
// already open (hot reload, second `ready` fire), leave it alone.
//
// The actual open is deferred to the next tick via `editor.setTimeout` so it
// never runs inline inside the `ready` hook — a split + widget-panel mount
// needs the event loop to be actively pumping, which a startup race can
// starve (the immediate symptom is the app appearing to hang on launch).
registerHandler("ai_chat_auto_open", () => {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.autoOpenChat) return;
  if (findChatBuffer() !== 0) return;
  editor.setTimeout(0, "ai_chat_auto_open_deferred");
});

registerHandler("ai_chat_auto_open_deferred", () => {
  void aiChatOpen();
});

// The debounced worker — scheduled via setTimeout from scheduleCompletion.
registerHandler("ai_completion_run_debounced", async () => {
  debounceTimerId = null;

  const bufferId = editor.getActiveBufferId();
  const cursorPos = editor.getCursorPosition();
  if (bufferId === 0 || cursorPos === null) return;

  lastRequestId += 1;
  void requestCompletion(bufferId, cursorPos, lastRequestId);
});

// =============================================================================
// Event subscriptions
// =============================================================================

editor.on("cursor_moved", () => {
  scheduleCompletion();
});

editor.on("buffer_activated", () => {
  const bufferId = editor.getActiveBufferId();
  if (bufferId === 0) return;
  scheduleCompletion();
});

editor.on("after_insert", () => {
  scheduleCompletion();
});

editor.on("after_delete", () => {
  clearGhost();
});

// Auto-open the chat panel once the editor has finished starting up.
// `ai_chat_auto_open` guards itself: plugin disabled → no-op; flag off →
// no-op; panel already open → no-op.
editor.on("ready", "ai_chat_auto_open");

editor.on("buffer_closed", (args) => {
  if (args.buffer_id === ghostBufferId) {
    clearGhost();
  }
  if (args.buffer_id === chatBufferId) {
    chatBufferId = 0;
    chatMessages = [];
    chatInputText = "";
    chatPanel = null;
  }
});

// Track the chat input's text so Enter can submit the draft. The widget
// emits `change` with `payload.value` on every keystroke; we keep it in a
// mirror (`chatInputText`) because the host owns the widget's value.
editor.on("widget_event", (e) => {
  if (e.panel_id !== CHAT_PANEL_ID) return;
  if (e.event_type === "focus") {
    chatFocusedWidget = e.widget_key || CHAT_INPUT_KEY;
    return;
  }
  if (e.event_type !== "change") return;
  const value = (e.payload as { value?: unknown }).value;
  if (typeof value !== "string") return;
  if (e.widget_key === CHAT_INPUT_KEY) {
    chatInputText = value;
    return;
  }
  if (e.widget_key === CHAT_MODEL_KEY) {
    selectedModel = value;
    return;
  }
  if (e.widget_key === CHAT_PROVIDER_KEY) {
    // Switching provider re-lists its models and clears the model choice.
    selectedProvider = value;
    selectedModel = null;
    chatModelList = [currentChatModel()];
    void refreshChatModels(value);
    return;
  }
});

// The chat buffer's editor mode: Enter submits the draft (the text input's
// own smart-key would otherwise just advance focus). The buffer itself is
// read-only — printable characters route to the widget input, not the
// buffer text — and we deliberately don't inherit normal bindings so the
// chat column doesn't act on ordinary editing keys.
editor.defineMode(
  "ai_chat",
  [
    ["Enter", "ai_chat_submit"],
    // The editor's native clipboard actions detect the focused Text widget
    // and operate on its selection/value instead of the read-only virtual
    // buffer underneath it.
    ["C-c", "copy"],
    ["C-v", "paste"],
    ["C-x", "cut"],
    ["C-a", "select_all"],
  ],
  true,
  false,
  false,
);

editor.on("config_changed", () => {
  if (!getConfig().enabled) {
    clearGhost();
    if (debounceTimerId !== null) {
      editor.clearInterval(debounceTimerId);
      debounceTimerId = null;
    }
  }
  lastRequestId += 1;
});

// =============================================================================
// Command palette registrations
// =============================================================================

editor.registerCommand(
  "%cmd.trigger",
  "%cmd.trigger_desc",
  "ai_completion_trigger",
  null,
);

editor.registerCommand(
  "%cmd.accept",
  "%cmd.accept_desc",
  "ai_completion_accept",
  null,
  { terminalBypass: true },
);

editor.registerCommand(
  "%cmd.dismiss",
  "%cmd.dismiss_desc",
  "ai_completion_dismiss",
  null,
  { terminalBypass: true },
);

editor.registerCommand(
  "%cmd.chat_open",
  "%cmd.chat_open_desc",
  "ai_chat_open",
  null,
);

editor.registerCommand(
  "%cmd.chat_toggle",
  "%cmd.chat_toggle_desc",
  "ai_chat_toggle",
  null,
);

editor.registerCommand(
  "%cmd.chat_send",
  "%cmd.chat_send_desc",
  "ai_chat_send",
  null,
);

editor.registerCommand(
  "%cmd.chat_accept",
  "%cmd.chat_accept_desc",
  "ai_chat_accept",
  null,
);

editor.registerCommand(
  "%cmd.chat_dismiss",
  "%cmd.chat_dismiss_desc",
  "ai_chat_dismiss",
  null,
);

// View ▸ Chat AI — the menu route to the same toggle as `%cmd.chat_toggle`
// and the `ai_chat_toggle` handler. It sits under "File Explorer" because
// the chat panel is the editor's other side column and users look for the
// two together (same placement rationale as the orchestor's dock toggle).
//
// Anchoring to the stable `"View"` menu id and the `"toggle_file_explorer"`
// row action keeps the placement locale-independent. The `chat_panel`
// checkbox is a host-computed menu-context key (the AI Chat virtual buffer
// is open in a visible split), which keeps the checkmark honest even when
// the panel is closed by a route the plugin didn't initiate.
editor.addMenuItem({
  menu: "View",
  label: editor.t("menu.ai_chat"),
  action: "ai_chat_toggle",
  checkbox: "chat_panel",
  after: "toggle_file_explorer",
});

// =============================================================================
// Initialization
// =============================================================================

if (getConfig().enabled) {
  editor.setStatus(editor.t("status.ready"));
} else {
  editor.debug(editor.t("status.disabled"));
}
