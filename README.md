# JiMeng Browser Automation

Playwright-based browser automation for [JiMeng AI](https://jimeng.jianying.com) (即梦AI), including hot video models such as `Seedance 2.0 Fast` and `Seedance 2.0`.

It supports:

- Douyin QR login
- image generation
- video generation
- `record-id` based status checks
- queued video cancelation
- image/video download

This repo is designed for agent use, but it is also usable directly from the command line.

## Install

```bash
npm install
npx playwright install chromium
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

## Normal workflow

1. `login`
2. `generate`
3. `record-status`
4. `download-record`

Use `cancel-record` only for queued video tasks you want to stop.

Always track tasks by `record-id`, not by page order.

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

- Models: `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- Reference modes: `全能参考`, `首尾帧`, `智能多帧`, `主体参考`
- Durations: `4s` to `15s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions seen: `720P`, `1080P`

One video task produces `1` MP4.

## Video mode compatibility

Choose the reference mode first, then choose a model that really works for that mode.

Current observed compatibility:

- `全能参考` -> `Seedance 2.0 Fast`, `Seedance 2.0`
- `首尾帧` -> `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- `智能多帧` -> `视频 3.0 Fast`, `视频 3.0`
- `主体参考` -> `视频 3.0`

The site can silently rewrite unsupported combinations. The script re-checks the final visible selection and fails fast on mismatch.

## Prompt rules

Keep structured choices in flags, not inside the prompt.

Good examples:

- `竖屏` -> `--aspect 9:16`
- `12 秒视频` -> `--duration 12s`
- `1080P` -> `--resolution 1080P`
- `主体参考` -> `--reference-mode 主体参考`

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
- `主体参考`: use `@主体`
- multiple subject images in `主体参考`: use local syntax `@主体1`, `@主体2`
- `首尾帧`: do not use prompt mentions; use `--first-frame-file` and `--last-frame-file`
- `智能多帧`: do not rely on prompt mention tokens

Important: plain text like `@图片1` is not enough by itself. The script converts these tokens into real JiMeng mention tags before submit.

## High-traffic Seedance behavior

Hot models such as `Seedance 2.0 Fast` and `Seedance 2.0` can be queue-heavy or temporarily reject new submits.

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
