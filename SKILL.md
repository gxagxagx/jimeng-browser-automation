---
name: jimeng-browser-automation
description: Automate JiMeng (即梦AI at jimeng.jianying.com) in a real browser with Playwright. Use for Douyin QR login, JiMeng image or video generation, record-id based status checks, and downloading completed results.
---

# JiMeng Browser Automation

Use the bundled Playwright driver for JiMeng. Keep the normal workflow small:

1. Ensure login
2. Generate an image or video task
3. Poll by `record-id`
4. Download the finished result

Always identify tasks by `record-id`, not by page order.

## Run from the skill directory

```bash
npm install
npx playwright install chromium
```

All commands below assume the current working directory is this skill directory.

## Minimal interface

Use these actions for normal agent work.

### 1. Ensure login

```bash
node scripts/jimeng-browser.js login
```

- Run this first when the session may be missing or stale.
- If login is required, the script saves a popup screenshot and a QR screenshot under `runtime/artifacts/`.
- Show the QR screenshot to the user and wait for a Douyin scan.
- The persistent browser profile lives under `runtime/jimeng-profile/`.
- Treat the entire `runtime/` directory as local private data. Do not commit it.

### 2. Generate image

```bash
node scripts/jimeng-browser.js generate --tool image --prompt "一只白色柴犬站在雨夜霓虹街头" --json true
```

Common optional flags:

- `--model`
- `--aspect`
- `--resolution`
- `--reference-file /absolute/path.png`

Behavior:

- Returns `recordId` on success.
- Text-only and text-plus-reference generation are both supported.
- Image tasks generate `4` result images per `record-id`.

### 3. Generate video

```bash
node scripts/jimeng-browser.js generate --tool video --prompt "让一只小猫坐在窗边，看向窗外的雨夜" --json true
```

Common optional flags:

- `--model`
- `--reference-mode`
- `--duration`
- `--aspect`
- `--resolution`
- `--reference-file /absolute/path`
- `--first-frame-file /absolute/path`
- `--last-frame-file /absolute/path`
- `--submit-retries`
- `--submit-retry-delay-ms`
- `--record-id-wait-ms`

Behavior:

- Returns `recordId` on success.
- Supports pure text, `主体参考`, `全能参考`, `首尾帧`, and `智能多帧`.
- Video tasks generate `1` MP4 per `record-id`.
- For high-traffic models, also inspect `serverAccepted`, `submitId`, `historyRecordId`, `serverRet`, and `serverErrmsg`.

### 4. Check task status

```bash
node scripts/jimeng-browser.js record-status --record-id <record-id> --json true
```

Returns structured status fields, including:

- `status`
- `isComplete`
- `isFailed`
- `progressPercent`
- `queuePosition`
- `queueTotal`
- `etaText`
- `historyRecordId`
- `auditFailureType`
- `auditFailurePhase`
- `failureReason`

Use this command before download when the task may still be queued or generating.

### 5. Download result

```bash
node scripts/jimeng-browser.js download-record --record-id <record-id> --wait-complete true --json true
```

Behavior:

- Image records download `4` PNG files.
- Video records download `1` MP4 file.
- Older records can still be recovered through the JiMeng history API fallback.

## Status model

For callers such as an agent or OpenClaw, map JiMeng results into these coarse states:

- `queued`: `排队加速中`, `生成中`, `造梦中`, `智能创意中`
- `completed`: `已完成`
- `failed`: any task with `isFailed=true`

Keep the raw `status` string for display and debugging.

Verified video failure cases:

- Submit-time input-policy reject: `你输入的文字不符合平台规则，请修改后重试`
- Post-generation output-policy reject: `视频未通过审核，本次不消耗积分`
- Peak-hour capacity reject: `因目前处于使用高峰期，暂时无法提交更多任务，请等待其他任务完成后再尝试提交～`

## Maintenance only

These commands are useful for debugging site changes, but they are not part of the normal minimal workflow:

- `node scripts/jimeng-browser.js snapshot --tool image|video`
- `node scripts/jimeng-browser.js open-tool --tool home|image|video|canvas`
- `node scripts/jimeng-browser.js find-record --record-id <record-id>`
- `node scripts/jimeng-browser.js list-records`

When selectors drift or the page structure changes, inspect [references/jimeng-flow.md](references/jimeng-flow.md) and patch [scripts/jimeng-browser.js](scripts/jimeng-browser.js).

## Bundled files

- `scripts/jimeng-browser.js`: browser driver and command entrypoint
- `references/jimeng-flow.md`: observed routes, selectors, queue behavior, and failure samples
- `runtime/tracked-records.jsonl`: local append-only task registry
