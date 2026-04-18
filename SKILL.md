---
name: jimeng-browser-automation
description: Automate JiMeng (即梦AI at jimeng.jianying.com), Seedance video generation, and canvas projects in a real browser with Playwright. Use for Douyin QR login, JiMeng image or video generation, canvas project creation/opening/prompting, record-id based status checks, canceling queued video tasks, and downloading completed results.
---

# JiMeng Browser Automation

Use the bundled Playwright driver for JiMeng.

Default workflow for image:

1. Ensure login
2. `generate --tool image` — returns `recordId`
3. `download-record --wait-complete true` — waits and downloads

Default workflow for video (async — video can queue for hours):

1. Ensure login
2. `generate --tool video` — submits and returns `recordId` immediately, does not wait
3. `record-status --record-id <id>` — poll until `isComplete=true`
4. `download-record --record-id <id>` — download once complete

Always identify tasks by `record-id`, not by page order.

## Daemon

Most commands reuse a background browser daemon. It starts automatically and
shuts itself down after 10 minutes of idle time. No manual management needed.

Commands routed through the daemon:
`generate`, `canvas-prompt`, `canvas-create-project`, `canvas-open-project`,
`canvas-rename-project`, `record-status`, `find-record`

`record-status` and `find-record` use a dedicated page inside the daemon so
polling never disturbs the generate/canvas page being kept warm.

To opt out: `--no-daemon true`
To change idle timeout: `--daemon-idle-timeout-ms <ms>` (default `600000`)

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
- Do not hide option labels such as `9:16`, `1080P`, `高清 2K`, `Seedance 2.0 Fast VIP`, `Seedance 2.0`, or `首尾帧` inside the prompt unless the user literally wants those words in the output.
- Exception: JiMeng mention tokens are part of the content binding, not normal option flags.
- Do not guess unavailable options. Use exact visible Chinese labels or omit the flag.
- Treat the entire `runtime/` directory as private local data. Do not commit it.

## Natural language to flags

- `竖屏` -> `--aspect 9:16`
- `横屏` -> usually `--aspect 16:9`
- `5 秒视频` -> `--duration 5s`
- `12 秒视频` -> `--duration 12s`
- `高清 2K` / `超清 4K` (image only) -> `--resolution 高清 2K` / `--resolution 超清 4K`
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

### 2. Open canvas home

```bash
node scripts/jimeng-browser.js open-tool --tool canvas
```

- The real canvas home route is `https://jimeng.jianying.com/ai-tool/assets-canvas`.
- This page lists recent projects and a `新建项目` entry point.

### 3. Create a canvas project

```bash
node scripts/jimeng-browser.js canvas-create-project --json true
```

- JiMeng opens the new project in a separate window.
- The command captures that new window and returns `projectId`, `projectUrl`, and `projectTitle`.

### 4. Open an existing canvas project

```bash
node scripts/jimeng-browser.js canvas-open-project --project-name "victor_测试" --json true
```

Optional:

- `--project-index` when multiple projects share the same visible name
- `--project-id`
- `--project-url`

Behavior:

- Clicking a recent project also opens a separate window.
- The command captures that new window and returns the resolved project URL.

### 5. Rename a canvas project

```bash
node scripts/jimeng-browser.js canvas-rename-project --project-id 123456 --name "my_project" --json true
```

Behavior:

- The current canvas page allows renaming by clicking the project name in the top-left header.
- The automation enters the inline title input, replaces the name, and confirms it.

### 6. Prompt inside a canvas project

```bash
node scripts/jimeng-browser.js canvas-prompt --project-id 123456 --kind image --prompt "一只白色柴犬坐在木桌上，白底，简洁插画风。" --json true
```

Optional:

- `--kind image|video|auto`
- `--model`
- `--aspect`
- `--resolution` (image only: `高清 2K`, `超清 4K`)
- `--duration` (video only: `4s` to `15s`)
- `--reference-mode` (video only: `全能参考`, `首尾帧`)
- `--reference-file /absolute/path[,/absolute/path2]`
- `--first-frame-file /absolute/path`
- `--last-frame-file /absolute/path`
- `--project-name`
- `--project-id`
- `--project-url`

Behavior:

- The automation first ensures the top-right `对话` drawer is open.
- It then uses the right-side conversation drawer input instead of the canvas bottom editor.
- The drawer exposes the same `图片生成 / 视频生成` tool choices as the normal generate page.
- The automation switches the drawer tool first, then reuses the normal image/video option logic.
- The prompt is sent as normal generate content. It is not wrapped with extra `生成一张图片：...` or `生成一个视频：...` prefixes.
- The command submits the prompt inside the project and now returns the underlying generation `recordId` when JiMeng surfaces it.
- Once `recordId` is available, the normal `record-status`, `download-record`, and `cancel-record` commands can be reused.
- The current observed project flow first enters an Agent planning phase before it calls JiMeng generation tools.
- If the project prompt includes JiMeng reference mentions such as `@图片1` or `@主体1`, the automation inserts real mention tags instead of plain text.

### 7. Generate image

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

### 8. Generate video

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

- Models observed live on 2026-04-15 in the default `全能参考` dropdown:
  `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, `Seedance 2.0`
- Supported video models: `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, `Seedance 2.0`
- Supported reference modes: `全能参考`, `首尾帧`
- Durations currently seen: `4s` to `15s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions: none (no resolution selector for video)

Behavior:

- Submits the task and returns immediately. Does not wait for generation to finish.
- Usually returns `recordId` on success. Use `record-status` to poll and `download-record` to fetch the file.
- Supports pure text, `全能参考`, and `首尾帧`.
- One video task produces `1` MP4.
- For hot models, inspect `serverAccepted`, `historyRecordId`, `serverRet`, and `serverErrmsg`.
- JiMeng can accept a task before the history card appears. `serverAccepted=true` with no `recordId` is accepted, not a hard failure.
- For `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, and `Seedance 2.0`, prefer:

```bash
--submit-retries 2 --submit-retry-delay-ms 60000 --record-id-wait-ms 180000
```

### 9. Check task status

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

### 10. Cancel queued video task

```bash
node scripts/jimeng-browser.js cancel-record --record-id <record-id> --json true
```

- Supported for video tasks.
- Uses JiMeng's direct cancel API.
- Works even if the card is no longer visible in the current list.

### 11. Download result

```bash
node scripts/jimeng-browser.js download-record --record-id <record-id> --wait-complete true --json true
```

- Image records download up to `4` PNG files.
- Video records download `1` MP4.
- Older records can still be recovered through the history API fallback.
- For partial image records, download every successful image that exists and record the counts in `record-download.json`.
- For video: poll with `record-status` first until `isComplete=true`, then call `download-record` without `--wait-complete`. This avoids blocking the daemon queue for hours.
- `--wait-complete true` is fine for image tasks (fast). For video tasks it blocks the caller for the full generation duration — avoid it unless you have a specific reason.

## Video reference-mode rules

Choose models from the reference mode first, not the other way around.

Current supported note from 2026-04-15:

- Keep video work on `全能参考` and `首尾帧`.
- Keep model choices on `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, and `Seedance 2.0`.
- `主体参考` and older video-model families are removed from supported guidance.

Important:

- JiMeng can silently rewrite incompatible model/mode combinations.
- The automation re-reads the final visible model and mode after selection and stops on mismatch.

## Mention rules

Mention tokens are only for modes that bind uploaded materials through the editor.

- `全能参考`: use `@图片1`, `@图片2`, `@图片3` in upload order.
- `首尾帧`: do not rely on prompt mention tokens. Use `--first-frame-file` and `--last-frame-file`.

Important:

- Plain text `@图片1` is not enough. The automation must select the popup option so JiMeng inserts a real mention tag node.
- The same mention insertion logic is also reused inside canvas project prompts when the active project editor supports uploaded-material mentions.

## Canvas project rules

- Canvas home is `assets-canvas`, not the normal generate route.
- `新建项目` opens a new canvas window at `/ai-tool/canvas/<projectId>?enter_from=create_new...`.
- Clicking a recent project opens a new canvas window at `/ai-tool/canvas/<projectId>?enter_from=assets...`.
- Clicking the project name in the top-left header enters inline rename mode.
- The preferred project generation entry is the top-right `对话` drawer.
- The drawer exposes `图片生成` and `视频生成`, and the resulting controls match the normal generate page closely enough to reuse the same option-selection logic.
- For now, treat project creation requests as prompt-driven:
  - image request -> `--kind image`
  - video request -> `--kind video`
- After submit, the project commonly enters `意图分析` / `任务规划` before the actual image/video generation step.

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
- canvas project window behavior
- failure and queue API shape
- mention behavior verification

## Maintenance only

These commands are useful for debugging site changes, but they are not part of the normal workflow:

- `node scripts/jimeng-browser.js snapshot --tool image|video`
- `node scripts/jimeng-browser.js open-tool --tool home|image|video|canvas`
- `node scripts/jimeng-browser.js canvas-create-project`
- `node scripts/jimeng-browser.js canvas-open-project --project-name "未命名项目"`
- `node scripts/jimeng-browser.js canvas-prompt --project-id 123456 --prompt "..."`
- `node scripts/jimeng-browser.js find-record --record-id <record-id>`
- `node scripts/jimeng-browser.js list-records`

## Bundled files

- `scripts/jimeng-browser.js`: browser driver and command entrypoint
- `references/jimeng-flow.md`: site observations and verified edge cases
- `runtime/tracked-records.jsonl`: local append-only task registry
