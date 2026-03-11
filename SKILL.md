---
name: jimeng-browser-automation
description: Automate JiMeng (即梦AI at jimeng.jianying.com) and Seedance video generation in a real browser with Playwright. Use for Douyin QR login, JiMeng image or video generation, record-id based status checks, canceling queued video tasks, and downloading completed results.
---

# JiMeng Browser Automation

Use the bundled Playwright driver for JiMeng.

Default workflow:

1. Ensure login
2. Submit an image or video task
3. Track it by `record-id`
4. Cancel a queued video task if needed
5. Download the finished result

Always identify tasks by `record-id`, not by page order.

## Setup

Run from this skill directory:

```bash
npm install
npx playwright install chromium
```

## Hard rules

- Ensure login before any generate action.
- Use structured flags for structured choices: `--model`, `--reference-mode`, `--duration`, `--aspect`, `--resolution`, `--reference-file`, `--first-frame-file`, `--last-frame-file`.
- Keep the prompt focused on content: subject, scene, action, emotion, camera language, style.
- Do not hide option labels such as `9:16`, `1080P`, `高清 2K`, `Seedance 2.0 Fast`, `主体参考`, or `首尾帧` inside the prompt unless the user literally wants those words in the output.
- Exception: JiMeng mention tokens are part of the content binding, not normal option flags.
- Do not guess unavailable options. Use exact visible Chinese labels or omit the flag.
- Treat the entire `runtime/` directory as private local data. Do not commit it.

## Natural language to flags

- `竖屏` -> `--aspect 9:16`
- `横屏` -> usually `--aspect 16:9`
- `5 秒视频` -> `--duration 5s`
- `12 秒视频` -> `--duration 12s`
- `高清 2K` / `1080P` -> `--resolution ...`
- `用这张图做主体参考` -> `--reference-mode 主体参考 --reference-file ...`
- `首尾帧过渡` -> `--reference-mode 首尾帧 --first-frame-file ... --last-frame-file ...`

## Minimal interface

Use these commands for normal agent work.

### 1. Ensure login

```bash
node scripts/jimeng-browser.js login
```

- Run this first when the session may be stale.
- If login is required, the script saves a popup screenshot and a QR screenshot under `runtime/artifacts/`.
- Show the QR screenshot to the user and wait for a Douyin scan.
- The persistent browser profile lives under `runtime/jimeng-profile/`.

### 2. Generate image

```bash
node scripts/jimeng-browser.js generate --tool image --prompt "一只白色柴犬站在雨夜霓虹街头" --json true
```

Required:

- `--prompt`

Optional:

- `--model`
- `--aspect`
- `--resolution`
- `--reference-file /absolute/path.png`

Observed image options:

- Models: `图片5.0 Lite`, `图片4.6`, `图片 4.5`, `图片 4.1`, `图片 4.0`, `图片 3.1`, `图片 3.0`
- Aspect ratios: `智能`, `21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, `9:16`
- Resolutions: `高清 2K`, `超清 4K`

Behavior:

- Returns `recordId` on success.
- Supports text-only and text-plus-reference generation.
- `--reference-file` accepts one or more absolute image paths, comma-separated.
- One image task can produce up to `4` result images.
- Image tasks can partially fail. Treat them as finished with partial failure, not as a pure hard failure.

### 3. Generate video

```bash
node scripts/jimeng-browser.js generate --tool video --prompt "让一只小猫坐在窗边，看向窗外的雨夜" --json true
```

Required:

- `--prompt`

Optional:

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

Observed video options:

- Models: `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- Reference modes: `全能参考`, `首尾帧`, `智能多帧`, `主体参考`
- Durations currently seen: `4s` to `15s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions seen: `720P`, `1080P`

Behavior:

- Usually returns `recordId` on success.
- Supports pure text, `全能参考`, `主体参考`, `首尾帧`, and `智能多帧`.
- One video task produces `1` MP4.
- For hot models, inspect `serverAccepted`, `historyRecordId`, `serverRet`, and `serverErrmsg`.
- JiMeng can accept a task before the history card appears. `serverAccepted=true` with no `recordId` is accepted, not a hard failure.
- Resolution availability is dynamic. Not every model, aspect ratio, and reference-mode combination exposes the same resolution.
- For `Seedance 2.0 Fast` and `Seedance 2.0`, prefer:

```bash
--submit-retries 2 --submit-retry-delay-ms 60000 --record-id-wait-ms 180000
```

### 4. Check task status

```bash
node scripts/jimeng-browser.js record-status --record-id <record-id> --json true
```

Useful fields:

- `status`
- `isComplete`
- `isFailed`
- `isCanceled`
- `canCancel`
- `progressPercent`
- `queuePosition`
- `queueTotal`
- `etaText`
- `historyRecordId`
- `failedCount`
- `partialFailure`
- `auditFailureType`
- `auditFailurePhase`
- `failureReason`

### 5. Cancel queued video task

```bash
node scripts/jimeng-browser.js cancel-record --record-id <record-id> --json true
```

- Supported for video tasks.
- Uses JiMeng's direct cancel API.
- Works even if the card is no longer visible in the current list.

### 6. Download result

```bash
node scripts/jimeng-browser.js download-record --record-id <record-id> --wait-complete true --json true
```

- Image records download up to `4` PNG files.
- Video records download `1` MP4.
- Older records can still be recovered through the history API fallback.
- For partial image records, download every successful image that exists and record the counts in `record-download.json`.
- Default wait timeout is `900000` ms. For hot queues, poll with `record-status` first or increase the timeout.

## Video reference-mode rules

Choose models from the reference mode first, not the other way around.

Current observed compatibility:

- `全能参考` -> `Seedance 2.0 Fast`, `Seedance 2.0`
- `首尾帧` -> `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- `智能多帧` -> `视频 3.0 Fast`, `视频 3.0`
- `主体参考` -> `视频 3.0`

Important:

- JiMeng can silently rewrite incompatible model/mode combinations.
- The automation re-reads the final visible model and mode after selection and stops on mismatch.

## Mention rules

Mention tokens are only for modes that bind uploaded materials through the editor.

- `全能参考`: use `@图片1`, `@图片2`, `@图片3` in upload order.
- `主体参考`: use `@主体`. If multiple subject images are uploaded, use local syntax `@主体1`, `@主体2` to choose the first and second visible `主体` options deterministically.
- `智能多帧`: do not rely on prompt mention tokens.
- `首尾帧`: do not rely on prompt mention tokens. Use `--first-frame-file` and `--last-frame-file`.

Important:

- Plain text `@图片1` is not enough. The automation must select the popup option so JiMeng inserts a real mention tag node.
- Verified live: `主体参考` submits reach JiMeng as structured reference nodes, not degraded plain text like `让@@`.

## Status model

Map JiMeng results into these coarse states:

- `queued`: `排队加速中`, `生成中`, `造梦中`, `智能创意中`
- `completed`: `已完成`
- `canceled`: `已取消`
- `failed`: any task with `isFailed=true`

Special case:

- Partial image tasks can be both complete and failed: `isComplete=true`, `isFailed=true`, `partialFailure=true`

Verified failure cases:

- Submit-time reject: `你输入的文字不符合平台规则，请修改后重试`
- Post-generation reject: `视频未通过审核，本次不消耗积分`
- Peak-hour reject: `因目前处于使用高峰期，暂时无法提交更多任务，请等待其他任务完成后再尝试提交～`
- User cancel: `你已取消生成，积分已返还`

## When to read references

Read [references/jimeng-flow.md](references/jimeng-flow.md) when you need:

- exact current option labels
- selector/debugging detail
- route and login observations
- failure and queue API shape
- mention behavior verification

## Maintenance only

These commands are useful for debugging site changes, but they are not part of the normal workflow:

- `node scripts/jimeng-browser.js snapshot --tool image|video`
- `node scripts/jimeng-browser.js open-tool --tool home|image|video|canvas`
- `node scripts/jimeng-browser.js find-record --record-id <record-id>`
- `node scripts/jimeng-browser.js list-records`

## Bundled files

- `scripts/jimeng-browser.js`: browser driver and command entrypoint
- `references/jimeng-flow.md`: site observations and verified edge cases
- `runtime/tracked-records.jsonl`: local append-only task registry
