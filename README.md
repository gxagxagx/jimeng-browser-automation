# JiMeng Browser Automation

Playwright-based browser automation for [JiMeng AI](https://jimeng.jianying.com) (即梦AI by ByteDance). Designed as a skill for AI agents and [OpenClaw](https://github.com/anthropics/openclaw).

Supports Douyin QR-code login, image/video generation, task status polling by `record-id`, and downloading completed results — all driven from the command line.

## Quick Start

```bash
npm install
npx playwright install chromium
```

First-time login (saves a persistent browser profile under `runtime/`):

```bash
node scripts/jimeng-browser.js login
```

The script saves a QR screenshot to `runtime/artifacts/`. Scan it with Douyin to authenticate. Subsequent runs reuse the stored session automatically.

## Commands

### Core Workflow

#### 1. Login

```bash
node scripts/jimeng-browser.js login
```

Opens JiMeng, triggers the Douyin OAuth popup, saves QR and popup screenshots under `runtime/artifacts/`. Waits for the user to scan and approve.

#### 2. Generate Image

```bash
node scripts/jimeng-browser.js generate \
  --tool image \
  --prompt "一只白色柴犬站在雨夜霓虹街头" \
  --json true
```

Returns `recordId` on success. Each image task produces **4 result images**.

Optional flags: `--model`, `--aspect`, `--resolution`, `--reference-file`

#### 3. Generate Video

```bash
node scripts/jimeng-browser.js generate \
  --tool video \
  --prompt "让一只小猫坐在窗边，看向窗外的雨夜" \
  --json true
```

Returns `recordId` on success. Each video task produces **1 MP4**.

Optional flags: `--model`, `--reference-mode`, `--duration`, `--aspect`, `--resolution`, `--reference-file`, `--first-frame-file`, `--last-frame-file`, `--submit-retries`, `--submit-retry-delay-ms`, `--record-id-wait-ms`

Supported reference modes: `全能参考`, `首尾帧`, `智能多帧`, `主体参考`

#### 4. Check Task Status

```bash
node scripts/jimeng-browser.js record-status \
  --record-id <record-id> \
  --json true
```

Returns structured fields:

| Field | Description |
|-------|-------------|
| `status` | Human-readable status string |
| `isComplete` | `true` when results are ready |
| `isFailed` | `true` when the task has failed |
| `progressPercent` | Generation progress (0–100) |
| `queuePosition` / `queueTotal` | Queue position if queued |
| `etaText` | Estimated time remaining |
| `auditFailureType` | `input-policy`, `output-policy`, `capacity-limit`, or `null` |
| `failureReason` | Failure message from JiMeng |

#### 5. Download Result

```bash
node scripts/jimeng-browser.js download-record \
  --record-id <record-id> \
  --wait-complete true \
  --json true
```

- Image records: downloads **4 PNG** files
- Video records: downloads **1 MP4** file
- Older records can be recovered through the JiMeng history API fallback

### Maintenance Commands

These are useful for debugging, not part of the normal agent workflow:

```bash
# Capture page screenshot + DOM snapshot
node scripts/jimeng-browser.js snapshot --tool image

# Open a tool page in the browser
node scripts/jimeng-browser.js open-tool --tool video

# Find a specific record card
node scripts/jimeng-browser.js find-record --record-id <record-id>

# List locally tracked records
node scripts/jimeng-browser.js list-records
```

## Agent Integration

Typical agent/OpenClaw workflow:

```
1. login              → Ensure session is valid (show QR if needed)
2. generate           → Submit task, get recordId
3. record-status      → Poll until isComplete=true or isFailed=true
4. download-record    → Download finished files
```

All core commands support `--json true` for structured output. When enabled:
- Success: `{ "ok": true, "command": "...", "recordId": "...", ... }`
- Failure: `{ "ok": false, "error": "..." }`
- Progress logs go to stderr, JSON result goes to stdout

Always identify tasks by `record-id`, not by page order.

### Example: Full Image Generation Flow

```bash
# Step 1: Ensure login
node scripts/jimeng-browser.js login

# Step 2: Generate
node scripts/jimeng-browser.js generate \
  --tool image \
  --prompt "赛博朋克风格的东京街头" \
  --model "图片5.0 Lite" \
  --aspect "16:9" \
  --json true
# → { "ok": true, "recordId": "abc123", ... }

# Step 3: Poll status
node scripts/jimeng-browser.js record-status \
  --record-id abc123 \
  --json true
# → { "isComplete": true, "status": "已完成", ... }

# Step 4: Download
node scripts/jimeng-browser.js download-record \
  --record-id abc123 \
  --wait-complete true \
  --json true
# → { "ok": true, "fileCount": 4, "files": [...] }
```

## Options Reference

### Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json true\|false` | `false` | Emit structured JSON to stdout |
| `--headless true\|false` | `true` | Run browser in headless mode |
| `--timeout-ms` | `180000` | General operation timeout (ms) |
| `--user-data-dir` | `runtime/jimeng-profile/` | Persistent browser profile directory |
| `--artifacts-dir` | `runtime/artifacts/` | Screenshot and snapshot output directory |
| `--registry-path` | `runtime/tracked-records.jsonl` | Local task registry file |

### Generate Flags

| Flag | Applies To | Description |
|------|-----------|-------------|
| `--tool image\|video` | Both | Generation type |
| `--prompt "..."` | Both | Text prompt (required) |
| `--model` | Both | Model name (e.g. `图片5.0 Lite`, `Seedance 2.0 Fast`) |
| `--aspect` | Both | Aspect ratio (e.g. `16:9`, `1:1`, `9:16`) |
| `--resolution` | Both | Resolution (e.g. `高清 2K`, `1080P`) |
| `--reference-file` | Both | Reference image path(s), comma-separated |
| `--reference-mode` | Video | `全能参考`, `首尾帧`, `智能多帧`, `主体参考` |
| `--duration` | Video | `5s` or `10s` |
| `--first-frame-file` | Video | First frame image for 首尾帧 mode |
| `--last-frame-file` | Video | Last frame image for 首尾帧 mode |
| `--submit-retries` | Video | Retry count on submit failure (default: 2 for video) |
| `--submit-retry-delay-ms` | Video | Delay between retries (default: 60000) |
| `--record-id-wait-ms` | Video | Max wait for record card to appear (default: 180000) |
| `--character-id` | Both | Tag for tracking by character/session |

### Download Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--record-id` | — | Record to download (required) |
| `--wait-complete` | `true` | Wait for task completion before downloading |
| `--wait-timeout-ms` | `900000` | Max wait time for completion (15 min) |
| `--poll-interval-ms` | `15000` | Status check interval while waiting |
| `--output-dir` | `runtime/artifacts/record-<id>/` | Download output directory |

## Status Model

Map JiMeng task states to these coarse categories:

| Category | JiMeng Status Strings |
|----------|----------------------|
| **Queued** | `排队加速中`, `生成中`, `造梦中`, `智能创意中` |
| **Completed** | `已完成` |
| **Failed** | Any task with `isFailed=true` |

Known failure types:

| Type | Example Message |
|------|-----------------|
| Input policy reject | `你输入的文字不符合平台规则，请修改后重试` |
| Output policy reject | `视频未通过审核，本次不消耗积分` |
| Capacity limit | `因目前处于使用高峰期，暂时无法提交更多任务...` |

## Project Structure

```
jimeng-browser-automation/
├── SKILL.md                      # Skill definition (agent-facing)
├── package.json                  # Dependencies (playwright)
├── scripts/
│   └── jimeng-browser.js         # Browser driver and all commands
├── agents/
│   └── openai.yaml               # OpenAI agent interface config
├── references/
│   └── jimeng-flow.md            # Site routes, selectors, observed behaviors
└── runtime/                      # (gitignored) local data
    ├── jimeng-profile/            # Persistent browser session
    ├── artifacts/                 # Screenshots, downloads, snapshots
    └── tracked-records.jsonl      # Local task registry
```

## Notes

- The `runtime/` directory is local-only and gitignored. It contains login sessions and downloaded files.
- JiMeng updates its UI frequently. When selectors break, run `snapshot` on the affected tool page and update selectors in `scripts/jimeng-browser.js` against `references/jimeng-flow.md`.
- The script masks Playwright's automation fingerprint (`webdriver` property) to avoid detection.
- For parallel runs, use separate `--user-data-dir` paths to avoid session conflicts.
