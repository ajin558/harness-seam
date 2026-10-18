# The model seam

DeepSeek Harness keeps the model behind one service (`ctx.llm`). A profile
chooses *which adapter* fills that service; the agent loop, tools, and session
model never change. That is the seam this repo uses.

## Composition

A profile is three layers, later wins:

1. **Bundles** — declared in the profile's `package.json`:
   `dsh-base` (core services) plus an app bundle (`dsh-web-app` for the browser
   UI, `dsh-headless` for one-shot CLI).
2. **The bundle's own patch** — rows that mount tools, providers, UI plugins.
3. **Your profile patch** — `cordis.patch.yml`: id-targeted overrides,
   disables, and inserts. This is the only file you should edit.

A row is `{ id, name, config, disabled? }`. Giving `id` targets an existing row;
adding `name` inserts one. `!!js` expressions are allowed and are evaluated at
composition time (that is how platform-specific rows are disabled).

## Provider routes

`@deepseek-ai/dsh-llm-pi-ai` is a multi-provider adapter. Its `providers` map is
the whole configuration surface: each key is a route name that a request selects
by `provider`.

Wire protocols this adapter can speak:

| `api` | Use for |
|---|---|
| `openai-completions` | OpenAI-compatible gateways, self-hosted servers, most proxies |
| `openai-responses` | OpenAI Responses API (plus `azure-openai-responses`, `openai-codex-responses`) |
| `anthropic-messages` | Anthropic-native APIs |

Credentials are references (`apiKeyEnv`), resolved per request through the
harness credential store — never inline secrets.

## Two gotchas worth knowing

**Permission presets are mandatory.** Without a `dsh-permission-presets` row, a
tool call tries to grant itself write access and fails on Windows with
`SetNamedSecurityInfoW failed (Win32 5)`. Both profiles here include the row.

**OpenAI-compatible gateways often omit `usage` in streaming responses.** The
harness then records zero tokens, and context accounting (and therefore
compaction) loses its input. See `../patches/streaming-usage.md`.

## Cost shape

The standard profile ships about 32 tool schemas. That is roughly 26k input
tokens per request before any conversation. Latency per step is dominated by the
gateway, not by the harness.
