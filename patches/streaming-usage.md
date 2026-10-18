# Patch: make an OpenAI-compatible gateway report streaming usage

## Symptom

- The harness UI shows `0 tok/s` and `0%` context usage.
- Session logs record `{ "inputTokens": 0, "outputTokens": 0 }`.
- Compaction never triggers, because the token meter has nothing to measure.

## Cause

OpenAI's streaming format carries usage in a **final chunk with empty
`choices`**:

```json
{"id":"...","object":"chat.completion.chunk","model":"...","choices":[],"usage":{"prompt_tokens":123,"completion_tokens":45,"total_tokens":168}}
```

Many proxies emit only content deltas and a `finish_reason` chunk, so the client
never sees usage.

## Fix (proxy side)

After writing the finish chunk and before `[DONE]`, emit the usage chunk if you
have the numbers:

```js
write(finishChunk);
if (result.usage) {
  write({ id, object: "chat.completion.chunk", created, model, choices: [], usage: result.usage });
}
res.write("data: [DONE]\n\n");
```

`result.usage` must be `{ prompt_tokens, completion_tokens, total_tokens }`.
If your upstream reports `input_tokens` / `output_tokens` (Gemini-style), map
them before writing.

## Verify

Run one short task, then read the session log:

```
{"inputTokens":26231,"outputTokens":482,"totalTokens":26713}
```

Non-zero input tokens means the fix landed. The UI percentage should move with
it.

## Note

Non-streaming (`stream: false`) responses already carry `usage` in the response
body; this patch only matters for the streaming path.
