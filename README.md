# JiMeng Browser Automation

Playwright-based browser automation for [JiMeng AI](https://jimeng.jianying.com) (即梦AI), including current Seedance video models such as `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, and `Seedance 2.0`, plus canvas project automation.

It supports:

- Douyin QR login
- image generation
- video generation
- canvas project creation/opening/prompting
- `record-id` based status checks
- queued video cancelation
- image/video download

This repo is designed for agent use, but it is also usable directly from the command line.

## Install

```bash
npm install
npx playwright install chromium
```

Runtime requirement: Node.js `18+`.

Basic smoke check:

```bash
npm test
```

## Quick start

Login first:

```bash
node scripts/jimeng-browser.js login
```

Generate an image:

```bash
node scripts/jimeng-browser.js generate \
  --tool image \
  --prompt "一只白色柴犬站在雨夜霓虹街头" \
  --json true
```

Generate a video:

```bash
node scripts/jimeng-browser.js generate \
  --tool video \
  --prompt "让一只小猫坐在窗边，看向窗外的雨夜" \
  --json true
```

Check status:

```bash
node scripts/jimeng-browser.js record-status \
  --record-id <record-id> \
  --json true
```

Download result:

```bash
node scripts/jimeng-browser.js download-record \
  --record-id <record-id> \
  --wait-complete true \
  --json true
```

Cancel a queued video task:

```bash
node scripts/jimeng-browser.js cancel-record \
  --record-id <record-id> \
  --json true
```

Canvas project workflow:

```bash
# Open canvas home
node scripts/jimeng-browser.js open-tool --tool canvas

# Create a new project (opens a new window and returns projectId/projectUrl)
node scripts/jimeng-browser.js canvas-create-project --json true

# Open an existing project by name
node scripts/jimeng-browser.js canvas-open-project \
  --project-name "victor_测试" \
  --json true

# Rename a project
node scripts/jimeng-browser.js canvas-rename-project \
  --project-id <project-id> \
  --name "my_project" \
  --json true

# Prompt inside a project via the top-right conversation drawer
node scripts/jimeng-browser.js canvas-prompt \
  --project-id <project-id> \
  --kind image \
  --prompt "一只白色柴犬坐在木桌上，白底，简洁插画风。" \
  --json true
```

## Normal workflow

### Image

1. `login`
2. `generate --tool image` — returns `recordId` quickly
3. `download-record --wait-complete true` — waits internally and downloads

### Video

Video generation can queue for minutes to hours. Use the async workflow:

1. `login`
2. `generate --tool video` — submits and returns `recordId` immediately
3. `record-status --record-id <id>` — poll until `isComplete=true`
4. `download-record --record-id <id>` — download once complete

Use `cancel-record` only for queued video tasks you want to stop.

Always track tasks by `record-id`, not by page order.

## Daemon

Most commands reuse a background browser daemon so repeated calls skip the
browser cold-start cost. The daemon starts automatically on the first call and
shuts itself down after 10 minutes of idle time. No manual management needed.

Commands that go through the daemon:
`generate`, `canvas-prompt`, `canvas-create-project`, `canvas-open-project`,
`canvas-rename-project`, `record-status`, `find-record`

`record-status` and `find-record` use a dedicated page inside the daemon so
they never interfere with the generate/canvas page that is being kept warm.

To opt out: `--no-daemon true`
To change the idle timeout: `--daemon-idle-timeout-ms <ms>`

For canvas projects:

1. `open-tool --tool canvas`
2. `canvas-create-project` or `canvas-open-project`
3. `canvas-prompt`

## Common options

### Image

Optional flags:

- `--model`
- `--aspect`
- `--resolution`
- `--reference-file`

Observed image options:

- Models: `图片5.0 Lite`, `图片4.6`, `图片 4.5`, `图片 4.1`, `图片 4.0`, `图片 3.1`, `图片 3.0`
- Aspect ratios: `智能`, `21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, `9:16`
- Resolutions: `高清 2K`, `超清 4K`

One image task can produce up to `4` images.

### Video

Optional flags:

- `--model`
- `--reference-mode`
- `--duration`
- `--aspect`
- `--resolution`
- `--reference-file`
- `--first-frame-file`
- `--last-frame-file`
- `--submit-retries`
- `--submit-retry-delay-ms`
- `--record-id-wait-ms`

Observed video options:

- Models observed live on 2026-04-15 in the default `全能参考` dropdown:
  `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, `Seedance 2.0`
- Supported video models: `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, `Seedance 2.0`
- Supported reference modes: `全能参考`, `首尾帧`
- Durations: `4s` to `15s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions: none (no resolution selector for video)

One video task produces `1` MP4.

## Video mode compatibility

Choose the reference mode first, then choose a model that really works for that mode.

Current supported note from 2026-04-15:

- Keep video work on `全能参考` and `首尾帧`.
- Keep model choices on `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, and `Seedance 2.0`.
- `主体参考` and older video-model families are removed from supported guidance.

The site can silently rewrite unsupported combinations. The script re-checks the final visible selection and fails fast on mismatch.

## Prompt rules

Keep structured choices in flags, not inside the prompt.

Good examples:

- `竖屏` -> `--aspect 9:16`
- `12 秒视频` -> `--duration 12s`
- `超清 4K` (image only) -> `--resolution 超清 4K`
- `首尾帧过渡` -> `--reference-mode 首尾帧`

Keep the prompt focused on content:

- subject
- scene
- action
- emotion
- motion
- camera language
- style

## Reference binding rules

Some video modes use JiMeng mention tokens inside the prompt to bind uploaded materials.

- `全能参考`: use `@图片1`, `@图片2`, `@图片3` in upload order
- `首尾帧`: do not use prompt mentions; use `--first-frame-file` and `--last-frame-file`

Important: plain text like `@图片1` is not enough by itself. The script converts these tokens into real JiMeng mention tags before submit.

## Canvas projects

The real canvas home route is:

- `https://jimeng.jianying.com/ai-tool/assets-canvas`

Observed behavior:

- `新建项目` opens a new browser window
- clicking a recent project also opens a new browser window
- clicking the project name in the top-left header enters inline rename mode
- use the top-right `对话` drawer as the project generation entry
- the drawer itself exposes `图片生成` and `视频生成`
- the drawer controls behave like the normal generate page, so the same model/aspect/resolution/duration/reference-mode flags can be reused there

Current project-generation rule:

- use `--kind image` to submit an image request
- use `--kind video` to submit a video request
- the prompt itself stays raw, like the normal generate page

Observed project flow:

- after submit, the project commonly enters `意图分析` or `任务规划`
- then Agent continues toward JiMeng generation inside the project
- when JiMeng surfaces the underlying task card, `canvas-prompt` now returns the standard `recordId`
- after that, you can reuse `record-status`, `download-record`, and `cancel-record`

## High-traffic Seedance behavior

Hot models such as `Seedance 2.0 Fast VIP`, `Seedance 2.0 VIP`, `Seedance 2.0 Fast`, and `Seedance 2.0` can be queue-heavy or temporarily reject new submits.

Recommended retry settings:

```bash
--submit-retries 2 --submit-retry-delay-ms 60000 --record-id-wait-ms 180000
```

Possible outcomes:

- normal success with `recordId`
- accepted submit with delayed card creation: `serverAccepted=true` but no `recordId` yet
- explicit capacity reject from JiMeng

Treat `serverAccepted=true` as accepted, not as a hard failure.

## Status model

`record-status` returns structured fields such as:

- `status`
- `isComplete`
- `isFailed`
- `isCanceled`
- `canCancel`
- `progressPercent`
- `queuePosition`
- `queueTotal`
- `etaText`
- `failureReason`

Typical coarse states:

- `queued`
- `completed`
- `canceled`
- `failed`

Special case:

- image tasks can be partially successful and partially failed at the same time

## Privacy

Do not commit `runtime/`.

It may contain:

- browser profile data
- login session state
- QR screenshots
- generated files
- local task tracking data

## More detail

- Agent-facing skill doc: [SKILL.md](./SKILL.md)
- Site observations and edge cases: [references/jimeng-flow.md](./references/jimeng-flow.md)
- Main driver: [scripts/jimeng-browser.js](./scripts/jimeng-browser.js)
