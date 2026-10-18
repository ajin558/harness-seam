# eval kit

Six fixed cases, objective checks, one table. The point is to turn
"this model feels worse in the harness" into something you can point at.

## Run

```powershell
cd eval
node run.cjs
node run.cjs --only c3_chain
```

Configuration is by environment variable (all optional):

| Variable | Default |
|---|---|
| `DSH_EXE` | `D:\deep seek harness\dsh\DeepSeek Harness.exe` |
| `DSH_CLI` | that install's `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js` |
| `DSH_HOME` | `%USERPROFILE%\.dsh` |
| `DSH_WORKSPACE` | current directory; `{{ROOT}}` in cases expands to it |
| `DSH_PROFILE` | `probe` |

The target profile must be a headless one (`profiles/minimal`).

## Cases

| id | What it probes | Checks |
|---|---|---|
| `c1_text` | Obeying "no tools", exact output | stdout contains token; tool calls = 0 |
| `c2_read` | Reading a fixture for one fact | stdout contains value; tool calls ≥ 1 |
| `c3_chain` | Copy → append → verify | output file 11 lines, source still 10, tool calls ≥ 2 |
| `c4_instruction` | Instruction beats habit (no digits) | stdout has no `[0-9]`; tool calls ≥ 1 |
| `c5_error` | Fail once, report the error, don't retry | tool calls = 1; stdout names the file |
| `c6_long` | Six independent writes | file 6 lines; tool calls ≥ 6 |

## Baseline

Gemini 3.8 Flash through a local OpenAI-compatible bridge, 2026-10-18:

| case | result | steps | tools | wall |
|---|---|---|---|---|
| c1_text | PASS | 1 | 0 | 18 s |
| c2_read | PASS | 2 | 1 | 33 s |
| c3_chain | PASS | 4 | 3 | 92 s |
| c4_instruction | PASS | 2 | 1 | 46 s |
| c5_error | PASS | 2 | 1 | 44 s |
| c6_long | PASS | 8 | 7 | 146 s |

6/6, about six minutes. A 33-step task on the same setup ran with zero tool
errors and no slowdown across steps.

## Honest note

An earlier version of `c2` asserted two port numbers that were not in the file
under test. The model answered correctly; the case was wrong. Checks must match
what the fixture actually contains — keep that in mind when adding cases.

## Gotcha: running from inside a harness session

If you launch the runner from inside a dsh session, the environment carries
`DSH_PROFILE=desktop`, `DSH_PROFILE_DIR`, `DSH_SESSION_ID`, `DSH_SHELL`, and
`DSH_WEB_URL`. Inherited, they make the child refuse to start:

```
error: profile "desktop" is managed exclusively by the Electron application
```

The runner deletes those five variables before spawning and never reads
`DSH_PROFILE` for its own default (use `--profile` or `EVAL_PROFILE`).
