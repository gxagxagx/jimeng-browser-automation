# JiMeng flow notes

Verified during local testing on 2026-03-10.

## Observed routes

- `https://jimeng.jianying.com/` loads the marketing site without authentication.
- `https://jimeng.jianying.com/ai-tool/home` loads the application shell and shows `登录` when the session is not authenticated.
- `https://jimeng.jianying.com/ai-tool/generate/?type=image` is the authenticated image-generation route.
- `https://jimeng.jianying.com/ai-tool/generate/?type=video` is the authenticated video-generation route.
- Even if logged-out pages expose prompt surfaces, treat the session as invalid and authenticate before generation.

## Observed login flow

1. Open `/ai-tool/home`.
2. Click `登录`.
3. Handle the agreement modal if it appears. The confirm button text is `同意`.
4. JiMeng opens a separate Douyin OAuth popup.
5. Save both the full popup screenshot and the QR-only screenshot before waiting for the user to scan.
6. Treat popup navigation to `/passport/web/web_login_success` as the main success signal.

## Selector guidance

- Prefer exact Chinese text selectors first: `登录`, `同意`, `图片生成`, `视频生成`, `无限画布`.
- Keep the popup logic separate from the main JiMeng page logic.
- When generation selectors fail, run `snapshot` and inspect the JSON dump instead of guessing.
- Logged-in image prompt placeholder: `请描述你想生成的图片`.
- Logged-in image prompt placeholder after uploading a reference image: `描述你想如何调整图片`.
- Logged-in video prompt placeholder: `输入文字，描述你想创作的画面内容、运动方式等。例如：一个3D形象的小男孩，在公园滑滑板。`
- Logged-in image and video submit buttons both expose the class fragment `submit-button-KJTUYS`.
- The blocking CapCut-binding dialog exposed a close target with the class fragment `close-icon-wrapper`.

## Observed image-generation options

Observed after login:

- Models: `图片5.0 Lite`, `图片4.6`, `图片 4.5`, `图片 4.1`, `图片 4.0`, `图片 3.1`, `图片 3.0`
- Aspect ratios: `智能`, `21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, `9:16`
- Resolutions: `高清 2K`, `超清 4K`

## Observed video-generation options

Observed after login:

- Model option prefixes: `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- Reference modes: `全能参考`, `首尾帧`, `智能多帧`, `主体参考`
- Durations: `5s`, `10s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions: `720P`, `1080P`
- Resolution options are dynamic; the same value is not always available across aspect, model, and reference-mode combinations.

## Verified behaviors

- Text-only image generation works.
- Text plus reference-image generation works.
- Text-only video generation works.
- Video generation with `主体参考` works.
- Video generation with `全能参考` works.
- Video generation with `首尾帧` can submit successfully even when the new history card appears late.
- High-traffic Seedance submissions can fail with a capacity limit and may need delayed retry.
- Older records can be recovered through `POST /mweb/v1/get_history_by_ids` even when the visible history list no longer contains the card.

## Status and failure patterns

Observed status patterns from the history API:

- `status=20`: queued or generating
- `status=30`: failed
- `status=50`: completed

Observed useful queue fields:

- `queue_info.queue_idx`
- `queue_info.queue_length`
- `queue_info.queue_status`

Verified failure categories:

- Submit-time input-policy reject
  - Typical message: `你输入的文字不符合平台规则，请修改后重试`
  - Typical shape: `status=30`, `task.status=10`
- Post-generation output-policy reject
  - Typical message: `视频未通过审核，本次不消耗积分`
  - Typical shape: `status=30`, `task.status=40`
- Peak-hour capacity reject
  - Typical message: `因目前处于使用高峰期，暂时无法提交更多任务，请等待其他任务完成后再尝试提交～`
  - Typical shape: submit API reject, not a completed record

## Notes for future tuning

- JiMeng changes its logged-in UI frequently. Re-snapshot the relevant page after each visible UI change.
- Validate selectors and option names against a live session before depending on unattended runs.
