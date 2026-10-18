# Troubleshooting

Four failures we actually hit, in the order you are likely to meet them.

## 1. Tool calls fail with `SetNamedSecurityInfoW failed (Win32 5)`

**Symptom.** The model calls a tool, the call fails immediately, and the model
explains that the workspace is blocked by Windows file permissions.

**Cause.** The profile declares no permission preset. The sandbox falls back to
`workspace-write`, tries to grant itself write access on the workspace root, and
the ACL write is denied.

**Fix.** Add the `dsh-permission-presets` row (both profiles here include it):

```yaml
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only: { sandbox: read-only, approval: ask }
      workspace-write: { sandbox: workspace-write, approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
    defaultPreset: workspace-write
```

This one cannot be caught by `--dump-config`; it only appears when a tool runs.

## 2. `0 tok/s` and `0%` context usage in the UI

**Symptom.** Everything works, but the token counters stay at zero and compaction
never triggers.

**Cause.** The gateway does not emit `usage` on the streaming path. The client
parses it only if it arrives.

**Fix.** Emit a final chunk with empty `choices` and a `usage` object. See
[`../patches/streaming-usage.md`](../patches/streaming-usage.md).

## 3. `error: profile "desktop" is managed exclusively by the Electron application`

**Symptom.** Launching a second profile, or the eval runner, fails instantly
even though `--profile mine` is on the command line.

**Cause.** The shell you launched from carries `DSH_PROFILE=desktop`,
`DSH_PROFILE_DIR`, `DSH_SESSION_ID`, `DSH_SHELL`, and `DSH_WEB_URL`. A child that
inherits them is treated as a second instance of the desktop profile.

**Fix.** Unset those five variables before launching, or launch from a plain
terminal. `eval/run.cjs` already does this.

## 4. The model answers, but the tools never fire

**Three different causes, in order of likelihood:**

1. **The model is not calling tools.** Some endpoints accept `tools` in the
   request and silently ignore them. Check the raw response for `tool_calls`.
2. **`reasoning_effort` is unsupported.** If the route declares an effort the
   gateway rejects, the request may fail before tools are considered. Remove the
   field or declare `reasoningEfforts` on the model.
3. **The profile has no tool plugins.** A headless bundle ships fewer rows than
   the web bundle; confirm with `dsh --profile <name> --dump-config`.

## Reading a session log by hand

Session logs are `session.v4.jsonl.zstd`, **one zstd frame per append**. A plain
single-frame decoder stops after the first chunk. Decode in a loop until the
input is consumed:

```js
let off = 0;
while (off < buf.length) {
  const r = zlib.zstdDecompressSync(buf.subarray(off), { info: true });
  if (!r.engine.bytesWritten) break;
  chunks.push(r.buffer);
  off += r.engine.bytesWritten;
}
```

The first line is the session header; every other line is an event with `type`,
`seq`, `time`, and `data`.
