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

Selection rules:

- Use exact Chinese labels when setting options.
- If the user does not require a specific model, aspect ratio, or resolution, omitting that flag is safer than guessing.
- `--reference-file` is the normal way to drive text-plus-reference image generation.
- Keep prompts semantic. Put model, aspect ratio, resolution, and reference files into flags instead of embedding labels like `9:16`, `2K`, or model names into the prompt.

## Observed video-generation options

Observed after login:

- Model option prefixes: `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- Reference modes: `全能参考`, `首尾帧`, `智能多帧`, `主体参考`
- Observed durations on the current page: `4s`, `5s`, `6s`, `7s`, `8s`, `9s`, `10s`, `11s`, `12s`, `13s`, `14s`, `15s`
- Aspect ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Resolutions: `720P`, `1080P`
- Resolution options are dynamic; the same value is not always available across aspect, model, and reference-mode combinations.

Selection rules:

- Use exact Chinese labels when setting options.
- If the user does not require a specific model, duration, aspect ratio, or resolution, omitting that flag is safer than guessing.
- `全能参考`, `主体参考`, and most `智能多帧` flows use `--reference-file`.
- `首尾帧` uses `--first-frame-file` and `--last-frame-file`.
- For hot `Seedance 2.0 Fast` and `Seedance 2.0` queues, use submit retries and longer wait windows.
- Keep prompts semantic. Put model, duration, aspect ratio, resolution, and reference mode into flags instead of embedding labels such as `9:16`, `1080P`, `12s`, or `首尾帧` into the prompt.
- Exception for reference-binding modes: prompt mention tokens are part of the content binding and should stay in the prompt.
- `全能参考` uses numbered material labels such as `@图片1` and `@图片2`.
- `主体参考` uses the semantic label `@主体`.
- If multiple subjects are uploaded in `主体参考`, the current picker shows duplicate visible labels `主体`, `主体`. The automation should use local syntax `@主体1`, `@主体2` to select the first and second visible `主体` options.
- Verified live: when two images are uploaded in `全能参考`, the editor switches from `textarea` to a ProseMirror rich-text editor, and typing `@` opens a picker with `图片1`, `图片2`.
- Plain text `@图片1` is not enough. The automation must choose the popup option so JiMeng inserts a real mention tag node.
- Verified live on 2026-03-11: in `主体参考`, the active generator shows the picker label `主体`, and a successful submit with `让@主体...` sent `idip_meta_list = [text, idip_frame, text]` in the generate request payload.
- Verified live on 2026-03-11: a two-subject `主体参考` submit sent `idip_meta_list = [text, idip_frame(image_idx=0), text, idip_frame(image_idx=1), text]`.
- `智能多帧` currently does not expose a rich-text mention picker in the active generator. Treat it as frame/timeline driven.
- `首尾帧` currently uses dedicated first-frame/last-frame uploads plus a plain textarea. Do not rely on prompt mention tokens there.
- The current editor hint says `上传1-5张参考图或视频`, so the automation should treat multi-file `--reference-file` as a first-class path for `全能参考`.
- The current page can silently rewrite incompatible model/mode combinations. Verified on 2026-03-11: selecting `视频 3.0 Fast` and then `全能参考` changes the visible model back to `Seedance 2.0 Fast`.

Mode-first compatibility observations from 2026-03-11:

- `全能参考` -> `Seedance 2.0 Fast`, `Seedance 2.0`
- `首尾帧` -> `Seedance 2.0 Fast`, `Seedance 2.0`, `视频 3.5 Pro`, `视频 3.0 Pro`, `视频 3.0 Fast`, `视频 3.0`
- `智能多帧` -> `视频 3.0 Fast`, `视频 3.0`
- `主体参考` -> `视频 3.0`

Implementation note:

- Model selection must not use substring matching. `Seedance 2.0` must not match `Seedance 2.0 Fast`, and `视频 3.0` must not match `视频 3.0 Fast` or `视频 3.0 Pro`.

## Verified behaviors

- Text-only image generation works.
- Text plus reference-image generation works.
- Image tasks can complete with partial output: some tiles are downloadable while other tiles show `图片生成失败`.
- Text-only video generation works.
- Video generation with `主体参考` works.
- Video generation with `全能参考` works.
- Video generation with `全能参考` plus two uploaded images and prompt mentions `@图片1` / `@图片2` works.
- Video generation with `首尾帧` can submit successfully even when the new history card appears late.
- High-traffic Seedance submissions can fail with a capacity limit and may need delayed retry.
- Older records can be recovered through `POST /mweb/v1/get_history_by_ids` even when the visible history list no longer contains the card.
- Queued video tasks can be canceled through `POST /mweb/v1/aigc_draft/cancel_generate` with body `{"history_id":"<history_record_id>"}`.

## Status and failure patterns

Observed status patterns from the history API:

- `status=20`: queued or generating
- `status=30`: failed or user-canceled
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
- User-canceled video task
  - Typical message: `你已取消生成，积分已返还`
  - Typical shape: `status=30`, `task.status=30`, `queue_info.queue_status=3`
- Partial image completion
  - Typical shape: completed record with fewer successful images than `total_image_count`
  - Handle as finished with partial failure, not as a pure hard failure

## Notes for future tuning

- JiMeng changes its logged-in UI frequently. Re-snapshot the relevant page after each visible UI change.
- Validate selectors and option names against a live session before depending on unattended runs.
- The current mention picker behavior is viewport-sensitive. The automation is more reliable at `1280x720` than at a taller `1440x1200` viewport for `全能参考` mention insertion.
