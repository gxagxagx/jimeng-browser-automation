#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const DEFAULT_USER_DATA_DIR = path.join(RUNTIME_DIR, 'jimeng-profile');
const DEFAULT_ARTIFACTS_DIR = path.join(RUNTIME_DIR, 'artifacts');
const DEFAULT_REGISTRY_PATH = path.join(RUNTIME_DIR, 'tracked-records.jsonl');
const TOOL_URLS = {
  home: 'https://jimeng.jianying.com/ai-tool/home',
  image: 'https://jimeng.jianying.com/ai-tool/generate/?type=image',
  video: 'https://jimeng.jianying.com/ai-tool/generate/?type=video',
  canvas: 'https://jimeng.jianying.com/ai-tool/home'
};
const SUBMIT_LABELS = [
  '生成',
  '立即生成',
  '开始生成',
  '即刻想象',
  '生成图片',
  '生成视频'
];
let JSON_OUTPUT = false;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    i += 1;
  }
  return out;
}

function boolFlag(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function integerFlag(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isoTimestamp() {
  return new Date().toISOString();
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

function artifactPath(artifactsDir, baseName, extension) {
  return path.join(artifactsDir, `${timestamp()}-${baseName}.${extension}`);
}

function parseFileList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function setJsonOutput(enabled) {
  JSON_OUTPUT = enabled;
}

function logStep(message) {
  const line = `[jimeng] ${message}`;
  if (JSON_OUTPUT) {
    console.error(line);
    return;
  }
  console.log(line);
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function safeNetworkIdle(page, timeout = 15000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    await page.waitForTimeout(2000);
  }
}

async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await safeNetworkIdle(page);
}

async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function waitForNewPage(context, existingPages, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const page = context.pages().find((candidate) => !existingPages.has(candidate));
    if (page) {
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the Douyin OAuth popup.');
}

function parseCommonOptions(args) {
  const artifactsDir = path.resolve(args['artifacts-dir'] || DEFAULT_ARTIFACTS_DIR);
  const userDataDir = path.resolve(args['user-data-dir'] || DEFAULT_USER_DATA_DIR);
  const registryPath = path.resolve(args['registry-path'] || DEFAULT_REGISTRY_PATH);
  ensureDir(artifactsDir);
  ensureDir(userDataDir);
  ensureDir(path.dirname(registryPath));
  ensureDir(RUNTIME_DIR);
  return {
    artifactsDir,
    registryPath,
    userDataDir,
    headless: boolFlag(args.headless, true),
    timeoutMs: integerFlag(args['timeout-ms'], 180000)
  };
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 120) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function safeSlug(value, fallback = 'item') {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function loadRegistryEntries(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return [];
  }

  return fs.readFileSync(registryPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendRegistryEntry(registryPath, entry) {
  fs.appendFileSync(registryPath, `${JSON.stringify(entry)}\n`);
}

function maybeEmitJson(args, payload) {
  if (boolFlag(args.json, false)) {
    emitJson(payload);
  }
}

async function launchContext(options) {
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    viewport: { width: 1440, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled']
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });
  context.setDefaultTimeout(45000);
  return context;
}

async function getMainPage(context) {
  const existing = context.pages().find((page) => !page.isClosed());
  return existing || context.newPage();
}

async function getBodyText(page, maxLength = 8000) {
  const text = await page.locator('body').innerText().catch(() => '');
  return text.slice(0, maxLength);
}

async function pageLooksLoggedOut(page) {
  const loginButton = page.getByText('登录', { exact: true }).first();
  return isVisible(loginButton);
}

async function dismissBindingModal(page) {
  const closeLocators = [
    page.locator('.close-icon-wrapper-GXKG2I').first(),
    page.locator('[class*="close-icon-wrapper"]').first()
  ];

  for (const locator of closeLocators) {
    if (await isVisible(locator)) {
      await locator.click({ force: true });
      await page.waitForTimeout(400);
      logStep('Dismissed the CapCut binding modal.');
      return true;
    }
  }

  return false;
}

async function collectVisibleElements(page) {
  const locator = page.locator('button, a, [role="button"], input, textarea, [contenteditable="true"]');
  const count = Math.min(await locator.count(), 80);
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const current = locator.nth(i);
    const box = await current.boundingBox().catch(() => null);
    if (!box || box.width < 8 || box.height < 8) {
      continue;
    }

    const tagName = await current.evaluate((node) => node.tagName).catch(() => '');
    const role = await current.getAttribute('role').catch(() => null);
    const text = (await current.innerText().catch(() => '')).trim().slice(0, 180);
    const placeholder = await current.getAttribute('placeholder').catch(() => null);
    const type = await current.getAttribute('type').catch(() => null);
    const href = await current.getAttribute('href').catch(() => null);

    items.push({
      tagName,
      role,
      text,
      placeholder,
      type,
      href,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height)
    });
  }

  return items;
}

function inferRecordStatus(text) {
  const normalized = normalizeWhitespace(text);
  const markers = [
    ['视频未通过审核', '视频未通过审核'],
    ['未通过审核', '视频未通过审核'],
    ['因目前处于使用高峰期', '高峰期限流'],
    ['排队加速中', '排队加速中'],
    ['生成中', '生成中'],
    ['造梦中', '造梦中'],
    ['智能创意中', '智能创意中'],
    ['排队中', '排队中'],
    ['生成失败', '生成失败'],
    ['失败', '失败'],
    ['已完成', '已完成']
  ];

  for (const [marker, status] of markers) {
    if (normalized.includes(marker)) {
      return status;
    }
  }

  if (normalized.includes('重新编辑') || normalized.includes('再次生成') || normalized.includes('下载')) {
    return '已完成';
  }

  return null;
}

async function collectLoadedRecordCards(page, limit = 80) {
  const locator = page.locator('[data-id][id^="item_"], .item-Xh64V7[data-id]');
  const count = Math.min(await locator.count(), limit);
  const seen = new Set();
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const current = locator.nth(i);
    const recordId = await current.getAttribute('data-id').catch(() => null);
    if (!recordId || seen.has(recordId)) {
      continue;
    }

    seen.add(recordId);
    const text = normalizeWhitespace(await current.innerText().catch(() => ''));
    items.push({
      recordId,
      domId: await current.getAttribute('id').catch(() => null),
      dataIndex: await current.getAttribute('data-index').catch(() => null),
      text,
      status: inferRecordStatus(text)
    });
  }

  return items;
}

async function waitForNewRecordCard(page, previousIds, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const cards = await collectLoadedRecordCards(page);
    const freshCard = cards.find((card) => !previousIds.has(card.recordId));
    if (freshCard) {
      return freshCard;
    }

    await page.waitForTimeout(1200);
  }

  return null;
}

function promptFingerprint(prompt, maxLength = 36) {
  return normalizeWhitespace(prompt).slice(0, maxLength);
}

function findPromptRecord(cards, prompt) {
  const fingerprint = promptFingerprint(prompt);
  if (!fingerprint) {
    return null;
  }

  return cards.find((card) => card.text.includes(fingerprint)) || null;
}

function detectVideoPendingState(text) {
  const normalized = normalizeWhitespace(text);
  const markers = [
    '生成中',
    '排队加速中',
    '预计剩余',
    '去查看'
  ];

  return markers.find((marker) => normalized.includes(marker)) || null;
}

async function waitForSubmitState(page, options) {
  const started = Date.now();

  while (Date.now() - started < options.timeoutMs) {
    const cards = await collectLoadedRecordCards(page);
    const freshCard = cards.find((card) => !options.previousIds.has(card.recordId));
    if (freshCard) {
      return {
        recordCard: freshCard,
        signal: 'new-record'
      };
    }

    const promptCard = findPromptRecord(cards, options.prompt);
    if (promptCard) {
      return {
        recordCard: promptCard,
        signal: 'prompt-record'
      };
    }

    if (options.tool === 'video') {
      const pendingMarker = detectVideoPendingState(await getBodyText(page, 5000));
      if (pendingMarker) {
        return {
          recordCard: null,
          signal: 'video-pending',
          pendingMarker
        };
      }
    }

    await page.waitForTimeout(1200);
  }

  return {
    recordCard: null,
    signal: 'no-signal'
  };
}

async function waitForDelayedRecordCard(page, options) {
  const started = Date.now();

  while (Date.now() - started < options.timeoutMs) {
    const cards = await collectLoadedRecordCards(page);
    const promptCard = findPromptRecord(cards, options.prompt);
    if (promptCard) {
      return promptCard;
    }

    await page.waitForTimeout(options.reloadIntervalMs);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await safeNetworkIdle(page, 12000);
    await dismissBindingModal(page);
  }

  return null;
}

async function waitForGenerateApiResult(page, timeoutMs) {
  try {
    const response = await page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === 'POST' && candidate.url().includes('/mweb/v1/aigc_draft/generate');
    }, { timeout: timeoutMs });

    const bodyText = await response.text().catch(() => '');
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    const aigcData = body?.data?.aigc_data || {};
    const task = aigcData.task || {};
    return {
      httpStatus: response.status(),
      ret: body?.ret ?? null,
      errmsg: body?.errmsg ?? null,
      logid: body?.logid ?? body?.log_id ?? null,
      accepted: response.status() === 200 && String(body?.ret) === '0',
      historyRecordId: aigcData.history_record_id || task.history_id || null,
      taskId: task.task_id || null,
      submitId: task.submit_id || null,
      serverStatus: aigcData.status ?? task.status ?? null,
      body
    };
  } catch {
    return null;
  }
}

async function getRecordListContainer(page) {
  const candidates = [
    page.locator('.record-list-RjGugi').first(),
    page.locator('[class*="record-virtual-list"]').first(),
    page.locator('.scroll-list-gsJVWP').first()
  ];

  for (const locator of candidates) {
    if (await isVisible(locator)) {
      return locator;
    }
  }

  return null;
}

async function findRecordCardById(page, recordId, maxScrolls = 40) {
  const selector = `[data-id="${recordId}"]`;
  let locator = page.locator(selector).first();

  if (await locator.count().catch(() => 0)) {
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    if (await isVisible(locator)) {
      return locator;
    }
  }

  const container = await getRecordListContainer(page);
  if (!container) {
    return null;
  }

  await container.evaluate((node) => {
    node.scrollTop = 0;
  }).catch(() => null);
  await page.waitForTimeout(300);

  for (let i = 0; i < maxScrolls; i += 1) {
    locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.scrollIntoViewIfNeeded().catch(() => null);
      if (await isVisible(locator)) {
        return locator;
      }
    }

    const beforeTop = await container.evaluate((node) => node.scrollTop).catch(() => null);
    await container.evaluate((node) => {
      node.scrollBy(0, Math.max(240, Math.floor(node.clientHeight * 0.8)));
    }).catch(() => null);
    await page.waitForTimeout(400);
    const afterTop = await container.evaluate((node) => node.scrollTop).catch(() => null);

    if (beforeTop !== null && afterTop !== null && afterTop <= beforeTop) {
      break;
    }
  }

  return null;
}

async function collectRecordResultThumbnails(cardLocator) {
  const locator = cardLocator.locator('.record-box-wrapper-MDgaBP img.image-TLmgkP, .record-box-wrapper-MDgaBP [data-apm-action="ai-generated-image-record-card"]');
  const count = await locator.count();
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const current = locator.nth(i);
    const src = await current.getAttribute('src').catch(() => null);
    if (!src) {
      continue;
    }
    items.push({ index: i, src });
  }

  return items;
}

async function collectRecordVideoSources(scope) {
  const locator = scope.locator('video');
  const count = await locator.count();
  const seen = new Set();
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const current = locator.nth(i);
    const src = await current.evaluate((node) => node.currentSrc || node.src || '').catch(() => '');
    if (!src || src.includes('record-loading-animation') || seen.has(src)) {
      continue;
    }

    seen.add(src);
    items.push({
      index: items.length,
      src
    });
  }

  return items;
}

async function openResultViewerFromCard(cardLocator, imageIndex) {
  const clickTargets = cardLocator.locator('.record-box-wrapper-MDgaBP .image-card-container-qy7ui4, .record-box-wrapper-MDgaBP [role="button"]');
  const count = await clickTargets.count();
  if (imageIndex >= count) {
    throw new Error(`Image index ${imageIndex} is out of range for the current record card.`);
  }

  await clickTargets.nth(imageIndex).click({ force: true });
}

async function waitForViewerReady(page, timeoutMs = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const downloadButton = page.locator('button').filter({ hasText: '下载' }).last();
    const activeImage = page.locator('img.image-TLmgkP.noAnimation-tX02xm, img.image-TLmgkP').last();

    if (await isVisible(downloadButton) && await activeImage.count().catch(() => 0)) {
      return { downloadButton, activeImage };
    }

    await page.waitForTimeout(300);
  }

  throw new Error('Timed out waiting for the image viewer.');
}

async function closeViewer(page) {
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(500);
}

async function saveCurrentViewerImage(page, outputDir, baseName, index) {
  ensureDir(outputDir);
  const { downloadButton, activeImage } = await waitForViewerReady(page);
  const previewSrc = await activeImage.getAttribute('src').catch(() => null);
  await downloadButton.scrollIntoViewIfNeeded().catch(() => null);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    downloadButton.click({ force: true })
  ]);

  const suggested = download.suggestedFilename() || `${baseName}-${index + 1}.png`;
  const extension = path.extname(suggested) || '.png';
  const filePath = path.join(outputDir, `${baseName}-${String(index + 1).padStart(2, '0')}${extension}`);
  await download.saveAs(filePath);
  return {
    index,
    filePath,
    previewSrc
  };
}

async function openVideoDetailFromCard(page, cardLocator) {
  const clickTargets = [
    cardLocator.locator('.video-record-content-JwGmeX video').first(),
    cardLocator.locator('.video-card-container-NNzcYP').first(),
    cardLocator.locator('.video-card-wrapper-AX1jbL').first(),
    cardLocator.locator('.video-record-content-JwGmeX').first()
  ];

  for (const target of clickTargets) {
    if (!(await target.count().catch(() => 0))) {
      continue;
    }
    if (!(await isVisible(target))) {
      continue;
    }

    await target.click({ force: true });
    await page.waitForTimeout(800);
    return;
  }

  throw new Error('Could not open the video detail panel from the current record card.');
}

async function findActiveVideoOnPage(page) {
  const videos = page.locator('video');
  const count = await videos.count();

  for (let i = count - 1; i >= 0; i -= 1) {
    const current = videos.nth(i);
    const src = await current.evaluate((node) => node.currentSrc || node.src || '').catch(() => '');
    if (!src || src.includes('record-loading-animation')) {
      continue;
    }

    const box = await current.boundingBox().catch(() => null);
    if (!box || box.width < 60 || box.height < 60) {
      continue;
    }

    return {
      locator: current,
      src
    };
  }

  return null;
}

async function waitForVideoDetailReady(page, timeoutMs = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const downloadButton = page.locator('button').filter({ hasText: '下载' }).last();
    const activeVideo = await findActiveVideoOnPage(page);

    if (await isVisible(downloadButton) && activeVideo) {
      return { downloadButton, activeVideo };
    }

    await page.waitForTimeout(300);
  }

  throw new Error('Timed out waiting for the video detail panel.');
}

async function downloadUrlToFile(url, filePath) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
}

async function fetchHistoryByIds(page, submitIds) {
  const ids = (Array.isArray(submitIds) ? submitIds : [submitIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (!ids.length) {
    return {};
  }

  const response = await page.evaluate(async (recordIds) => {
    const request = await fetch('/mweb/v1/get_history_by_ids', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submit_ids: recordIds }),
      credentials: 'include'
    });

    return {
      status: request.status,
      text: await request.text()
    };
  }, ids);

  let body = null;
  try {
    body = JSON.parse(response.text);
  } catch {
    body = null;
  }

  if (response.status !== 200 || String(body?.ret) !== '0') {
    throw new Error(`History lookup failed: http=${response.status} ret=${body?.ret ?? '-'} errmsg=${body?.errmsg || '-'}`);
  }

  return body?.data || {};
}

async function fetchHistoryEntry(page, recordId) {
  const data = await fetchHistoryByIds(page, [recordId]);
  return data?.[recordId] || null;
}

function inferToolFromHistoryEntry(entry) {
  if (!entry) {
    return null;
  }

  if ((entry.item_list || []).some((item) => item?.video)) {
    return 'video';
  }
  if ((entry.item_list || []).some((item) => item?.image)) {
    return 'image';
  }

  if (Number(entry.generate_type) === 10) {
    return 'video';
  }
  if (Number(entry.generate_type) === 1) {
    return 'image';
  }

  return null;
}

function safeFileExtension(format, fallback) {
  const normalized = String(format || '').trim().replace(/^\./, '').toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return `.${normalized}`;
}

function extractHistoryEntryImageFiles(entry) {
  const items = entry?.item_list || [];
  const files = [];

  for (const item of items) {
    const largeImages = [...(item?.image?.large_images || [])].sort((left, right) => {
      return (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0);
    });
    const best = largeImages[0] || null;
    const url = best?.image_url || item?.common_attr?.cover_url || null;
    if (!url) {
      continue;
    }

    files.push({
      index: files.length,
      url,
      previewSrc: item?.common_attr?.cover_url || item?.common_attr?.cover_url_map?.['360'] || null,
      format: best?.format || item?.image?.format || 'png',
      width: best?.width || null,
      height: best?.height || null,
      size: best?.size || null
    });
  }

  return files;
}

function extractHistoryEntryVideoFiles(entry) {
  const items = entry?.item_list || [];
  const files = [];

  for (const item of items) {
    const originVideo = item?.video?.transcoded_video?.origin || null;
    const url = originVideo?.video_url || null;
    if (!url) {
      continue;
    }

    files.push({
      index: files.length,
      url,
      previewSrc: item?.video?.cover_url || null,
      format: originVideo?.format || 'mp4',
      width: originVideo?.width || null,
      height: originVideo?.height || null,
      size: originVideo?.size || null,
      durationMs: item?.video?.duration_ms || null
    });
  }

  return files;
}

function extractHistoryEntryFiles(entry, tool) {
  const resolvedTool = tool || inferToolFromHistoryEntry(entry);
  if (resolvedTool === 'video') {
    return extractHistoryEntryVideoFiles(entry);
  }
  return extractHistoryEntryImageFiles(entry);
}

function historyEntryFailureMessage(entry) {
  if (!entry) {
    return null;
  }

  const candidates = [
    entry.fail_starling_message,
    entry.fail_starling_key,
    entry?.task?.resp_ret?.errmsg,
    entry?.gen_result_data?.result_msg
  ]
    .map((value) => normalizeWhitespace(value || ''))
    .filter(Boolean)
    .filter((value) => !/^success$/i.test(value));

  if (candidates.length) {
    return candidates[0];
  }

  const status = Number(entry?.task?.status ?? entry?.status);
  if (Number.isFinite(status) && ![20, 50].includes(status)) {
    return `History status ${status}`;
  }

  return null;
}

function historyEntryStatusLabel(entry) {
  if (!entry) {
    return null;
  }

  const failure = historyEntryFailureMessage(entry);
  if (failure) {
    return failure;
  }

  const status = Number(entry?.task?.status ?? entry?.status);
  if (status === 50) {
    return '已完成';
  }
  if (status === 20) {
    return '生成中';
  }

  return null;
}

function historyEntryIsComplete(entry, tool) {
  if (!entry) {
    return false;
  }

  const status = Number(entry?.task?.status ?? entry?.status);
  if (status !== 50) {
    return false;
  }

  const files = extractHistoryEntryFiles(entry, tool);
  if ((tool || inferToolFromHistoryEntry(entry)) === 'video') {
    return files.length >= 1;
  }

  return files.length >= 4;
}

function extractHistoryEntryPrompt(entry) {
  const draft = entry?.draft_content;
  if (!draft) {
    return null;
  }

  try {
    const parsed = JSON.parse(draft);
    const component = (parsed.component_list || []).find((item) => item.type === 'video_base_component');
    const genVideo = component?.abilities?.gen_video;
    const input = genVideo?.text_to_video_params?.video_gen_inputs?.[0];
    return normalizeWhitespace(
      input?.prompt
      || input?.unified_edit_input?.meta_list?.map((item) => item.text).filter(Boolean).join(' | ')
      || ''
    ) || null;
  } catch {
    return null;
  }
}

function extractProgressPercentFromText(text) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/(\d{1,3})%\s*(?:造梦中|生成中)/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }

  return value;
}

function extractQueueInfoFromText(text) {
  const normalized = normalizeWhitespace(text);
  const queueMatch = normalized.match(/当前排队\((\d+)\s*\/\s*(\d+)\)\s*位/);
  const etaMatch = normalized.match(/预计剩余\s*([^，。]+)/);
  return {
    queuePosition: queueMatch ? Number.parseInt(queueMatch[1], 10) : null,
    queueTotal: queueMatch ? Number.parseInt(queueMatch[2], 10) : null,
    etaText: etaMatch ? normalizeWhitespace(etaMatch[1]) : null
  };
}

function classifyHistoryFailure(entry) {
  const message = normalizeWhitespace(entry?.fail_starling_message || historyEntryFailureMessage(entry) || '');
  const key = String(entry?.fail_starling_key || '').trim();
  const taskStatus = Number(entry?.task?.status ?? entry?.status);

  if (!message && !key) {
    return {
      failureType: null,
      failurePhase: null,
      failureReason: null
    };
  }

  if (
    key === 'ErrMessage_APP_OutputVideoRisk'
    || message.includes('视频未通过审核')
    || message.includes('生成的视频未通过审核')
  ) {
    return {
      failureType: 'output-policy',
      failurePhase: taskStatus === 40 ? 'post-generation' : 'policy-review',
      failureReason: message || '视频未通过审核，本次不消耗积分'
    };
  }

  if (
    key === 'web_text_violates_community_guidelines_toast'
    || key === 'web_prompt_violate_guidelines_tip'
    || message.includes('你输入的文字不符合平台规则')
    || message.includes('文字描述不符合平台规则')
    || message.includes('你上传的图片、文字或音频不符合平台规则')
  ) {
    return {
      failureType: 'input-policy',
      failurePhase: taskStatus === 10 ? 'submit-time' : 'pre-generation',
      failureReason: message || '你输入的文字不符合平台规则，请修改后重试'
    };
  }

  if (message.includes('因目前处于使用高峰期')) {
    return {
      failureType: 'capacity-limit',
      failurePhase: 'submit-time',
      failureReason: message
    };
  }

  return {
    failureType: 'generic-failure',
    failurePhase: taskStatus === 40 ? 'post-generation' : taskStatus === 10 ? 'submit-time' : null,
    failureReason: message || null
  };
}

function summarizeRecordStatus(recordId, tool, record, historyEntry) {
  const domText = record?.text || '';
  const domStatus = record?.status || null;
  const domQueue = extractQueueInfoFromText(domText);
  const historyStatus = historyEntryStatusLabel(historyEntry);
  const failure = classifyHistoryFailure(historyEntry);
  const historyQueue = historyEntry?.queue_info || {};
  const finishedCount = Number.isFinite(Number(historyEntry?.finished_image_count))
    ? Number(historyEntry.finished_image_count)
    : null;
  const totalCount = Number.isFinite(Number(historyEntry?.total_image_count))
    ? Number(historyEntry.total_image_count)
    : null;

  let status = historyStatus || domStatus || null;
  if (!status && failure.failureReason) {
    status = failure.failureReason;
  }
  if (domStatus && ['排队加速中', '造梦中', '智能创意中', '生成中'].includes(domStatus)) {
    status = domStatus;
  }
  if (domStatus === '已完成') {
    status = '已完成';
  }

  let progressPercent = extractProgressPercentFromText(domText);
  if (progressPercent === null && finishedCount !== null && totalCount !== null && totalCount > 0) {
    progressPercent = Math.round((finishedCount / totalCount) * 100);
  }

  const queuePosition = domQueue.queuePosition ?? (Number.isFinite(Number(historyQueue.queue_idx)) ? Number(historyQueue.queue_idx) : null);
  const queueTotal = domQueue.queueTotal ?? (Number.isFinite(Number(historyQueue.queue_length)) ? Number(historyQueue.queue_length) : null);
  const etaText = domQueue.etaText || null;
  const complete = recordIsComplete(record, tool) || historyEntryIsComplete(historyEntry, tool);
  const failed = Boolean(failure.failureReason) || (record ? isFailureStatus(record.status) : false);

  return {
    ok: true,
    command: 'record-status',
    recordId,
    tool,
    source: record && historyEntry ? 'dom+history-api' : record ? 'dom' : historyEntry ? 'history-api' : 'none',
    status,
    isComplete: complete,
    isFailed: failed,
    progressPercent,
    queuePosition,
    queueTotal,
    etaText,
    queueStatus: Number.isFinite(Number(historyQueue.queue_status)) ? Number(historyQueue.queue_status) : null,
    historyRecordId: historyEntry?.history_record_id || historyEntry?.task?.history_id || null,
    statusCode: Number.isFinite(Number(historyEntry?.status)) ? Number(historyEntry.status) : null,
    taskStatusCode: Number.isFinite(Number(historyEntry?.task?.status)) ? Number(historyEntry.task.status) : null,
    finishedCount,
    totalCount,
    auditFailureType: failure.failureType,
    auditFailurePhase: failure.failurePhase,
    failureReason: failure.failureReason,
    prompt: extractHistoryEntryPrompt(historyEntry) || null,
    cardText: domText ? truncateText(domText, 220) : null
  };
}

async function saveHistoryEntryFiles(entry, tool, outputDir, baseName) {
  ensureDir(outputDir);
  const files = extractHistoryEntryFiles(entry, tool);
  const resolvedTool = tool || inferToolFromHistoryEntry(entry) || 'image';
  const downloads = [];

  for (const file of files) {
    const suffix = resolvedTool === 'image'
      ? `-${String(file.index + 1).padStart(2, '0')}`
      : '';
    const fallbackExt = resolvedTool === 'video' ? '.mp4' : '.png';
    const extension = safeFileExtension(file.format, fallbackExt);
    const filePath = path.join(outputDir, `${baseName}${suffix}${extension}`);
    await downloadUrlToFile(file.url, filePath);
    downloads.push({
      index: file.index,
      filePath,
      previewSrc: file.previewSrc,
      sourceUrl: file.url,
      method: 'history-api',
      width: file.width || null,
      height: file.height || null,
      size: file.size || null,
      durationMs: file.durationMs || null
    });
  }

  return downloads;
}

async function saveCurrentVideo(page, outputDir, baseName) {
  ensureDir(outputDir);
  const { downloadButton, activeVideo } = await waitForVideoDetailReady(page);
  await downloadButton.scrollIntoViewIfNeeded().catch(() => null);

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      downloadButton.click({ force: true })
    ]);

    const suggested = download.suggestedFilename() || `${baseName}.mp4`;
    const extension = path.extname(suggested) || '.mp4';
    const filePath = path.join(outputDir, `${baseName}${extension}`);
    await download.saveAs(filePath);
    return {
      index: 0,
      filePath,
      previewSrc: activeVideo.src,
      method: 'browser-download'
    };
  } catch (error) {
    if (!activeVideo.src) {
      throw error;
    }

    const filePath = path.join(outputDir, `${baseName}.mp4`);
    await downloadUrlToFile(activeVideo.src, filePath);
    return {
      index: 0,
      filePath,
      previewSrc: activeVideo.src,
      method: 'direct-fetch'
    };
  }
}

function isFailureStatus(status) {
  return ['生成失败', '失败', '视频未通过审核', '高峰期限流'].includes(status);
}

function recordIsComplete(record, tool) {
  if (!record || record.status !== '已完成') {
    return false;
  }

  if (tool === 'video') {
    return record.videos.length >= 1;
  }

  return record.thumbnails.length >= 4;
}

async function locateRecordWithStatus(page, recordId) {
  const locator = await findRecordCardById(page, recordId);
  if (!locator) {
    return null;
  }

  const text = normalizeWhitespace(await locator.innerText().catch(() => ''));
  const status = inferRecordStatus(text);
  const thumbnails = await collectRecordResultThumbnails(locator);
  const videos = await collectRecordVideoSources(locator);
  return {
    locator,
    text,
    status,
    thumbnails,
    videos
  };
}

async function waitForRecordCompletion(page, recordId, tool, timeoutMs, pollIntervalMs) {
  const started = Date.now();
  let resolvedTool = tool;

  while (Date.now() - started < timeoutMs) {
    const record = await locateRecordWithStatus(page, recordId);
    const historyEntry = await fetchHistoryEntry(page, recordId).catch(() => null);
    resolvedTool = inferToolFromHistoryEntry(historyEntry) || resolvedTool;

    if (recordIsComplete(record, resolvedTool) || historyEntryIsComplete(historyEntry, resolvedTool)) {
      return {
        record,
        historyEntry,
        tool: resolvedTool
      };
    }
    if (record && isFailureStatus(record.status)) {
      throw new Error(`Record ${recordId} failed: ${truncateText(record.text, 200)}`);
    }
    const historyFailure = historyEntryFailureMessage(historyEntry);
    if (historyFailure) {
      throw new Error(`Record ${recordId} failed: ${historyFailure}`);
    }

    await page.waitForTimeout(pollIntervalMs);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await safeNetworkIdle(page, 12000);
    await dismissBindingModal(page);
  }

  return {
    record: null,
    historyEntry: null,
    tool: resolvedTool
  };
}

async function saveSnapshot(page, artifactsDir, label) {
  const screenshot = artifactPath(artifactsDir, `${label}-page`, 'png');
  const jsonPath = artifactPath(artifactsDir, `${label}-snapshot`, 'json');
  const textPath = artifactPath(artifactsDir, `${label}-body`, 'txt');
  const payload = {
    url: page.url(),
    title: await page.title(),
    bodyText: await getBodyText(page),
    visibleElements: await collectVisibleElements(page)
  };

  await page.screenshot({ path: screenshot, fullPage: true });
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(textPath, payload.bodyText);
  return { screenshot, jsonPath, textPath };
}

async function findQrImage(popup) {
  const images = popup.locator('img');
  const count = await images.count();
  let best = null;

  for (let i = 0; i < count; i += 1) {
    const current = images.nth(i);
    const box = await current.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    const isSquare = Math.abs(box.width - box.height) <= 8;
    if (!isSquare || box.width < 120 || box.height < 120) {
      continue;
    }

    if (!best || box.width * box.height > best.area) {
      best = { locator: current, area: box.width * box.height };
    }
  }

  if (!best) {
    throw new Error('Could not find the QR image in the Douyin OAuth popup.');
  }

  return best.locator;
}

async function openLoginPopup(homePage, context) {
  await gotoAndSettle(homePage, TOOL_URLS.home);

  const loginButton = homePage.getByText('登录', { exact: true }).first();
  if (!(await isVisible(loginButton))) {
    logStep('Did not find a visible 登录 button. Reusing the current session.');
    return null;
  }

  const existingPages = new Set(context.pages());
  await loginButton.click();
  await homePage.waitForTimeout(1200);

  const agreeButton = homePage.getByText('同意', { exact: true }).first();
  if (await isVisible(agreeButton)) {
    logStep('Accepted the agreement modal before login.');
    await agreeButton.click();
  }

  const popup = await waitForNewPage(context, existingPages, 15000);
  await popup.waitForLoadState('domcontentloaded');
  await safeNetworkIdle(popup, 10000);
  return popup;
}

async function waitForLoginResult(homePage, popup, timeoutMs) {
  const started = Date.now();
  let reloadEvery = 0;

  while (Date.now() - started < timeoutMs) {
    if (!popup.isClosed()) {
      const popupUrl = popup.url();
      if (popupUrl.includes('/passport/web/web_login_success')) {
        return { source: 'popup-callback', popupUrl };
      }

      const popupText = await getBodyText(popup, 800);
      if (popupText.includes('授权成功') || popupText.includes('登录成功')) {
        return { source: 'popup-text', popupUrl };
      }
    }

    reloadEvery += 1;
    if (reloadEvery >= 5) {
      reloadEvery = 0;
      await homePage.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await safeNetworkIdle(homePage, 8000);
      const loginButton = homePage.getByText('登录', { exact: true }).first();
      if (!(await isVisible(loginButton))) {
        return { source: 'home-page', popupUrl: popup.isClosed() ? null : popup.url() };
      }
    }

    if (popup.isClosed()) {
      const loginButton = homePage.getByText('登录', { exact: true }).first();
      if (!(await isVisible(loginButton))) {
        return { source: 'popup-closed', popupUrl: null };
      }
    }

    await homePage.waitForTimeout(1000);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for the JiMeng login flow to finish.`);
}

async function ensureLoggedIn(context, options) {
  const homePage = await getMainPage(context);
  const popup = await openLoginPopup(homePage, context);
  if (!popup) {
    return { homePage, popup: null, reusedSession: true };
  }

  return finalizeLogin(homePage, context, popup, options);
}

async function finalizeLogin(homePage, context, popup, options) {
  const popupScreenshot = artifactPath(options.artifactsDir, 'oauth-popup', 'png');
  const qrScreenshot = artifactPath(options.artifactsDir, 'oauth-qr', 'png');
  const qrImage = await findQrImage(popup);
  await popup.screenshot({ path: popupScreenshot, fullPage: true });
  await qrImage.screenshot({ path: qrScreenshot });
  logStep(`Saved the login popup screenshot: ${popupScreenshot}`);
  logStep(`Saved the QR screenshot: ${qrScreenshot}`);
  logStep('Scan the QR code with Douyin, then approve the login on the phone.');

  const loginResult = await waitForLoginResult(homePage, popup, options.timeoutMs);
  await safeNetworkIdle(homePage, 10000);
  const statePath = artifactPath(options.artifactsDir, 'storage-state', 'json');
  fs.writeFileSync(statePath, JSON.stringify(await context.storageState(), null, 2));
  logStep(`Login completed via ${loginResult.source}. Storage state: ${statePath}`);
  return { homePage, popup, qrScreenshot, popupScreenshot, statePath, loginResult };
}

async function navigateToTool(page, tool) {
  const resolvedTool = tool || 'home';
  const url = TOOL_URLS[resolvedTool] || TOOL_URLS.home;
  await gotoAndSettle(page, url);
  await dismissBindingModal(page);
  return page;
}

async function findPromptTarget(page) {
  const directTextareas = [
    page.locator('textarea[placeholder*="请描述你想生成的图片"]'),
    page.locator('textarea[placeholder*="描述你想如何调整图片"]'),
    page.locator('textarea[placeholder*="输入文字，描述你想创作的画面内容"]'),
    page.locator('textarea.prompt-textarea-l5tJNE')
  ];

  for (const locator of directTextareas) {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const current = locator.nth(i);
      if (await isVisible(current)) {
        return { type: 'textarea', locator: current };
      }
    }
  }

  const textarea = page.locator('textarea');
  const textareaCount = await textarea.count();
  for (let i = 0; i < textareaCount; i += 1) {
    const current = textarea.nth(i);
    const placeholder = await current.getAttribute('placeholder').catch(() => null);
    if (placeholder && placeholder.includes('搜索')) {
      continue;
    }
    if (await isVisible(current)) {
      return { type: 'textarea', locator: current };
    }
  }

  const editors = page.locator('[contenteditable="true"]');
  const editorCount = await editors.count();
  for (let i = 0; i < editorCount; i += 1) {
    const current = editors.nth(i);
    const box = await current.boundingBox().catch(() => null);
    if (box && box.width > 120 && box.height > 32) {
      return { type: 'editor', locator: current };
    }
  }

  const inputs = page.locator('input[type="text"], input:not([type])');
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    const current = inputs.nth(i);
    const placeholder = await current.getAttribute('placeholder').catch(() => null);
    if (!placeholder || placeholder.includes('搜索')) {
      continue;
    }
    if (await isVisible(current)) {
      return { type: 'input', locator: current };
    }
  }

  return null;
}

async function fillPrompt(target, prompt) {
  if (target.type === 'editor') {
    await target.locator.click();
    await target.locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
    await target.locator.fill(prompt).catch(async () => {
      await target.locator.evaluate((node, value) => {
        node.textContent = value;
      }, prompt);
    });
    return;
  }

  await target.locator.fill(prompt);
}

async function maybeUploadImage(page, imagePath) {
  const files = parseFileList(imagePath);
  if (!files.length) {
    return false;
  }

  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  for (let i = 0; i < count; i += 1) {
    const current = fileInputs.nth(i);
    try {
      await current.setInputFiles(files);
      await page.waitForTimeout(1200);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function setFileInputFiles(fileInput, files) {
  await fileInput.setInputFiles(files.length === 1 ? files[0] : files);
  await fileInput.page().waitForTimeout(1200);
}

async function maybeUploadVideoReferences(page, args) {
  const genericFiles = parseFileList(args['reference-file'] || args['image-file']);
  const firstFrameFiles = parseFileList(args['first-frame-file']);
  const lastFrameFiles = parseFileList(args['last-frame-file']);
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();

  if (!count) {
    return false;
  }

  if (firstFrameFiles.length || lastFrameFiles.length) {
    const referenceGroups = page.locator('.references-vWIzeo .reference-group-_DAGw1');
    if (firstFrameFiles.length) {
      await setFileInputFiles(referenceGroups.nth(0).locator('input[type="file"]').first(), firstFrameFiles);
    }
    if (lastFrameFiles.length) {
      const lastInput = referenceGroups.nth(1).locator('input[type="file"]').first();
      if (!(await lastInput.count().catch(() => 0))) {
        throw new Error('The current video mode does not expose a tail-frame file input for --last-frame-file.');
      }
      await setFileInputFiles(lastInput, lastFrameFiles);
    }
    return true;
  }

  if (!genericFiles.length) {
    return false;
  }

  if (count >= 2) {
    const inputDetails = [];
    for (let i = 0; i < Math.min(count, 2); i += 1) {
      inputDetails.push(await fileInputs.nth(i).evaluate((node) => ({ multiple: node.multiple })));
    }

    if (inputDetails.every((detail) => !detail.multiple)) {
      const referenceGroups = page.locator('.references-vWIzeo .reference-group-_DAGw1');
      await setFileInputFiles(referenceGroups.nth(0).locator('input[type="file"]').first(), [genericFiles[0]]);
      if (genericFiles[1]) {
        await setFileInputFiles(referenceGroups.nth(1).locator('input[type="file"]').first(), [genericFiles[1]]);
      }
      return true;
    }
  }

  for (let i = 0; i < count; i += 1) {
    const current = fileInputs.nth(i);
    try {
      await setFileInputFiles(current, genericFiles);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function findSubmitButton(page) {
  const directButtons = page.locator('button.submit-button-KJTUYS');
  const directCount = await directButtons.count();
  for (let i = 0; i < directCount; i += 1) {
    const locator = directButtons.nth(i);
    if (!(await isVisible(locator))) {
      continue;
    }
    if (await locator.isDisabled().catch(() => false)) {
      continue;
    }
    return { label: 'submit-button-KJTUYS', locator };
  }

  for (const label of SUBMIT_LABELS) {
    const locator = page.getByText(label, { exact: true }).first();
    if (await isVisible(locator)) {
      return { label, locator };
    }
  }

  const allButtons = page.locator('button, [role="button"], a');
  const count = Math.min(await allButtons.count(), 80);
  for (let i = 0; i < count; i += 1) {
    const current = allButtons.nth(i);
    if (!(await isVisible(current))) {
      continue;
    }
    const text = (await current.innerText().catch(() => '')).trim();
    if (!text) {
      continue;
    }
    if (text.includes('生成') || text.includes('想象')) {
      return { label: text, locator: current };
    }
  }

  return null;
}

async function chooseSelectOption(page, selectIndex, optionText) {
  if (!optionText) {
    return false;
  }

  const select = page.locator('.lv-select[role="combobox"]').nth(selectIndex);
  if (!(await isVisible(select))) {
    throw new Error(`Could not find select index ${selectIndex} for option ${optionText}.`);
  }

  await select.click({ force: true });
  await page.waitForTimeout(400);

  const option = page.locator('.lv-select-popup [role="option"]').filter({ hasText: optionText }).first();
  if (!(await isVisible(option))) {
    throw new Error(`Could not find select option: ${optionText}`);
  }

  await option.click({ force: true });
  await page.waitForTimeout(500);
  return true;
}

async function chooseToolbarOption(page, groupRole, optionText) {
  const groups = page.locator(`.lv-popover-content [role="${groupRole}"]`);
  const groupCount = await groups.count();
  for (let i = 0; i < groupCount; i += 1) {
    const option = groups.nth(i).locator('label').filter({ hasText: optionText }).first();
    if (await isVisible(option)) {
      await option.click({ force: true });
      await page.waitForTimeout(300);
      return true;
    }
  }

  return false;
}

async function configureImageOptions(page, args) {
  await dismissBindingModal(page);

  if (args.model) {
    await chooseSelectOption(page, 1, args.model);
    logStep(`Selected image model: ${args.model}`);
  }

  await configureAspectResolution(page, args, 'image');
}

async function configureAspectResolution(page, args, labelPrefix) {
  if (!args.aspect && !args.resolution) {
    return;
  }

  const toolbarButton = page.locator('button.toolbar-button-FhFnQ_').first();
  if (!(await isVisible(toolbarButton))) {
    throw new Error(`Could not find the ${labelPrefix} aspect/resolution toolbar button.`);
  }

  await toolbarButton.click({ force: true });
  await page.waitForTimeout(400);

  if (args.aspect) {
    const aspectChosen = await chooseToolbarOption(page, 'radiogroup', args.aspect);
    if (!aspectChosen) {
      throw new Error(`Could not find aspect option: ${args.aspect}`);
    }
    logStep(`Selected ${labelPrefix} aspect ratio: ${args.aspect}`);
  }

  if (args.resolution) {
    const resolutionChosen = await chooseToolbarOption(page, 'radiogroup', args.resolution);
    if (!resolutionChosen) {
      throw new Error(`Could not find resolution option: ${args.resolution}`);
    }
    logStep(`Selected ${labelPrefix} resolution: ${args.resolution}`);
  }

  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300);
}

async function configureVideoOptions(page, args) {
  await dismissBindingModal(page);

  if (args.model) {
    await chooseSelectOption(page, 1, args.model);
    logStep(`Selected video model: ${args.model}`);
  }

  if (args['reference-mode']) {
    await chooseSelectOption(page, 2, args['reference-mode']);
    logStep(`Selected video reference mode: ${args['reference-mode']}`);
  }

  if (args.duration) {
    await chooseSelectOption(page, 3, args.duration);
    logStep(`Selected video duration: ${args.duration}`);
  }

  await configureAspectResolution(page, args, 'video');
}

function createTrackedRecordEntry(args, tool, prompt, recordCard) {
  return {
    createdAt: isoTimestamp(),
    tool,
    characterId: args['character-id'] || null,
    prompt,
    recordId: recordCard.recordId,
    historyRecordId: recordCard.historyRecordId || null,
    taskId: recordCard.taskId || null,
    recordDomId: recordCard.domId || null,
    dataIndex: recordCard.dataIndex || null,
    status: recordCard.status || null,
    cardText: recordCard.text || '',
    model: args.model || null,
    aspect: args.aspect || null,
    resolution: args.resolution || null,
    duration: args.duration || null,
    referenceMode: args['reference-mode'] || null,
    referenceFiles: parseFileList(args['reference-file'] || args['image-file']),
    firstFrameFiles: parseFileList(args['first-frame-file']),
    lastFrameFiles: parseFileList(args['last-frame-file'])
  };
}

function selectTrackedEntry(entries, args) {
  const sorted = [...entries].sort((left, right) => {
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
  });

  if (args['record-id']) {
    return sorted.find((entry) => entry.recordId === args['record-id']) || null;
  }

  if (args['character-id']) {
    return sorted.find((entry) => entry.characterId === args['character-id']) || null;
  }

  return null;
}

function buildToolCandidates(preferredTool) {
  const candidates = [];

  for (const tool of [preferredTool, 'image', 'video']) {
    if (!tool || !['image', 'video'].includes(tool) || candidates.includes(tool)) {
      continue;
    }
    candidates.push(tool);
  }

  return candidates.length ? candidates : ['image', 'video'];
}

async function locateRecordAcrossTools(page, recordId, toolCandidates) {
  let lastTool = toolCandidates[0] || 'image';

  for (const tool of toolCandidates) {
    lastTool = tool;
    await navigateToTool(page, tool);
    await safeNetworkIdle(page, 10000);
    await dismissBindingModal(page);
    if (await pageLooksLoggedOut(page)) {
      throw new Error('JiMeng is not logged in. Run the login command before record lookup.');
    }

    const record = await locateRecordWithStatus(page, recordId);
    if (record) {
      return { tool, record };
    }
  }

  return { tool: lastTool, record: null };
}

async function commandLogin(args) {
  const options = parseCommonOptions(args);
  const context = await launchContext(options);

  try {
    const result = await ensureLoggedIn(context, options);
    const snapshot = await saveSnapshot(result.homePage, options.artifactsDir, 'logged-in-home');
    logStep(`Saved the post-login home snapshot: ${snapshot.screenshot}`);
  } finally {
    await context.close();
  }
}

async function commandSnapshot(args) {
  const options = parseCommonOptions(args);
  const context = await launchContext(options);

  try {
    const page = await getMainPage(context);
    const tool = args.tool || 'home';
    const url = args.url;
    if (url) {
      await gotoAndSettle(page, url);
    } else {
      await navigateToTool(page, tool);
    }

    const snapshot = await saveSnapshot(page, options.artifactsDir, `snapshot-${tool}`);
    logStep(`Saved screenshot: ${snapshot.screenshot}`);
    logStep(`Saved JSON snapshot: ${snapshot.jsonPath}`);
    logStep(`Saved body text: ${snapshot.textPath}`);
  } finally {
    await context.close();
  }
}

async function commandOpenTool(args) {
  const options = parseCommonOptions(args);
  const context = await launchContext(options);

  try {
    const page = await getMainPage(context);
    const tool = args.tool || 'home';
    await navigateToTool(page, tool);
    if (tool !== 'home' && await pageLooksLoggedOut(page)) {
      throw new Error(`JiMeng still shows 登录 after opening ${tool}. Run the login command first.`);
    }
    logStep(`Opened ${tool}. URL: ${page.url()}`);
    logStep(`Page title: ${await page.title()}`);
  } finally {
    await context.close();
  }
}

async function commandGenerate(args) {
  const prompt = args.prompt;
  if (!prompt) {
    throw new Error('The generate command requires --prompt "..."');
  }

  const options = parseCommonOptions(args);
  const context = await launchContext(options);

  try {
    const page = await getMainPage(context);
    const tool = args.tool || 'image';
    await navigateToTool(page, tool);
    await safeNetworkIdle(page, 10000);
    await dismissBindingModal(page);
    if (await pageLooksLoggedOut(page)) {
      throw new Error('JiMeng is not logged in. Run the login command before generate.');
    }

    if (tool === 'image') {
      await configureImageOptions(page, args);
    } else if (tool === 'video') {
      await configureVideoOptions(page, args);
    }

    let promptTarget = await findPromptTarget(page);
    if (!promptTarget) {
      const snapshot = await saveSnapshot(page, options.artifactsDir, `generate-missing-prompt-${tool}`);
      throw new Error(`Could not find a visible prompt field. Inspect ${snapshot.jsonPath}`);
    }

    await fillPrompt(promptTarget, prompt);
    const genericReferenceInput = args['reference-file'] || args['image-file'];
    const uploadRequested = tool === 'video'
      ? Boolean(genericReferenceInput || args['first-frame-file'] || args['last-frame-file'])
      : Boolean(genericReferenceInput);
    const uploadWorked = tool === 'video'
      ? await maybeUploadVideoReferences(page, args)
      : await maybeUploadImage(page, genericReferenceInput);
    if (uploadRequested) {
      const uploadLabel = tool === 'video'
        ? 'Uploaded the video reference file(s).'
        : 'Uploaded the reference image file.';
      const uploadMissLabel = tool === 'video'
        ? 'Did not find a file input for the video reference upload.'
        : 'Did not find a file input for the reference image upload.';
      logStep(uploadWorked ? uploadLabel : uploadMissLabel);
    }

    const submitRetries = integerFlag(args['submit-retries'], tool === 'video' ? 2 : 0);
    const retryDelayMs = integerFlag(args['submit-retry-delay-ms'], tool === 'video' ? 60000 : 15000);
    const recordIdWaitMs = integerFlag(args['record-id-wait-ms'], tool === 'video' ? 180000 : 60000);
    let beforeSnapshot = null;
    let afterSnapshot = null;
    let trackedRecord = null;
    let submitSignal = 'no-signal';
    let pendingMarker = null;
    let attemptCount = 0;
    let generateApiResult = null;

    for (let attempt = 0; attempt <= submitRetries; attempt += 1) {
      attemptCount = attempt + 1;
      const previousRecordIds = new Set((await collectLoadedRecordCards(page)).map((card) => card.recordId));
      beforeSnapshot = await saveSnapshot(page, options.artifactsDir, `generate-before-submit-${tool}`);
      const submitButton = await findSubmitButton(page);
      if (!submitButton) {
        throw new Error(`Could not find a submit button. Inspect ${beforeSnapshot.jsonPath}`);
      }

      logStep(`Clicking submit button: ${submitButton.label}`);
      const generateApiPromise = waitForGenerateApiResult(page, Math.min(options.timeoutMs, 30000));
      await submitButton.locator.click();
      generateApiResult = await generateApiPromise;

      if (generateApiResult && !generateApiResult.accepted) {
        const serverMessage = `Server rejected submit ret=${generateApiResult.ret ?? '-'} errmsg=${generateApiResult.errmsg || '-'}`;
        if (attempt < submitRetries) {
          logStep(`${serverMessage}. Waiting ${retryDelayMs}ms before retrying.`);
          await page.waitForTimeout(retryDelayMs);
          await dismissBindingModal(page);
          continue;
        }
        throw new Error(serverMessage);
      }

      const submitState = await waitForSubmitState(page, {
        previousIds: previousRecordIds,
        prompt,
        tool,
        timeoutMs: Math.min(options.timeoutMs, tool === 'video' ? 30000 : 20000)
      });
      await page.waitForTimeout(2000);
      afterSnapshot = await saveSnapshot(page, options.artifactsDir, `generate-after-submit-${tool}`);

      if (submitState.recordCard) {
        trackedRecord = submitState.recordCard;
        submitSignal = submitState.signal;
        pendingMarker = submitState.pendingMarker || null;
        trackedRecord = {
          ...trackedRecord,
          historyRecordId: generateApiResult?.historyRecordId || null,
          taskId: generateApiResult?.taskId || null
        };
        break;
      }

      if (submitState.signal === 'video-pending') {
        submitSignal = submitState.signal;
        pendingMarker = submitState.pendingMarker || null;
        trackedRecord = await waitForDelayedRecordCard(page, {
          prompt,
          timeoutMs: Math.min(options.timeoutMs, recordIdWaitMs),
          reloadIntervalMs: 15000
        });
        if (trackedRecord) {
          submitSignal = 'delayed-record';
          trackedRecord = {
            ...trackedRecord,
            historyRecordId: generateApiResult?.historyRecordId || null,
            taskId: generateApiResult?.taskId || null
          };
        } else if (generateApiResult?.accepted) {
          submitSignal = 'server-accepted-no-record-id';
        }
        break;
      }

      if (attempt < submitRetries) {
        logStep(`No clear success signal after submit attempt ${attemptCount}/${submitRetries + 1}. Waiting ${retryDelayMs}ms before retrying.`);
        await page.waitForTimeout(retryDelayMs);
        await dismissBindingModal(page);
      }
    }

    if (beforeSnapshot) {
      logStep(`Saved the pre-submit snapshot: ${beforeSnapshot.screenshot}`);
    }
    if (afterSnapshot) {
      logStep(`Saved the post-submit snapshot: ${afterSnapshot.screenshot}`);
    }

    let resultPayload = {
      ok: true,
      command: 'generate',
      tool,
      prompt,
      recordId: null,
      expectedImageCount: tool === 'image' ? 4 : null,
      expectedVideoCount: tool === 'video' ? 1 : null,
      beforeSnapshot: beforeSnapshot.screenshot,
      afterSnapshot: afterSnapshot.screenshot,
      registryPath: options.registryPath,
      trackingSaved: false,
      submitSignal,
      pendingMarker,
      attemptCount,
      serverAccepted: generateApiResult?.accepted || false,
      historyRecordId: generateApiResult?.historyRecordId || null,
      taskId: generateApiResult?.taskId || null,
      submitId: generateApiResult?.submitId || null,
      serverRet: generateApiResult?.ret ?? null,
      serverErrmsg: generateApiResult?.errmsg ?? null,
      serverHttpStatus: generateApiResult?.httpStatus ?? null,
      serverStatus: generateApiResult?.serverStatus ?? null
    };

    if (trackedRecord) {
      const registryEntry = createTrackedRecordEntry(args, tool, prompt, trackedRecord);
      appendRegistryEntry(options.registryPath, registryEntry);
      logStep(`Tracked recordId=${registryEntry.recordId}${registryEntry.characterId ? ` characterId=${registryEntry.characterId}` : ''}`);
      logStep(`Registry entry saved: ${options.registryPath}`);
      resultPayload = {
        ...resultPayload,
        recordId: registryEntry.recordId,
        status: registryEntry.status,
        trackingSaved: true,
        registryEntry
      };
    } else {
      if (generateApiResult?.accepted) {
        logStep(`Server accepted the submit, but no JiMeng record card appeared before the timeout. historyRecordId=${generateApiResult.historyRecordId || '-'} taskId=${generateApiResult.taskId || '-'}`);
      } else {
        logStep('Submit state stayed ambiguous and no new record card appeared before the timeout. Inspect the post-submit snapshot.');
      }
      resultPayload = {
        ...resultPayload,
        status: generateApiResult?.accepted ? 'server-accepted-no-record-id' : 'submitted-no-record-id'
      };
    }

    maybeEmitJson(args, resultPayload);
  } finally {
    await context.close();
  }
}

async function commandListRecords(args) {
  const options = parseCommonOptions(args);
  const limit = integerFlag(args.limit, 20);
  const entries = loadRegistryEntries(options.registryPath)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .filter((entry) => {
      if (args.tool && entry.tool !== args.tool) {
        return false;
      }
      if (args['character-id'] && entry.characterId !== args['character-id']) {
        return false;
      }
      if (args['record-id'] && entry.recordId !== args['record-id']) {
        return false;
      }
      return true;
    })
    .slice(0, limit);

  if (!entries.length) {
    logStep(`No tracked records matched. Registry: ${options.registryPath}`);
    return;
  }

  for (const entry of entries) {
    logStep(
      [
        `recordId=${entry.recordId}`,
        `tool=${entry.tool || '-'}`,
        `characterId=${entry.characterId || '-'}`,
        `createdAt=${entry.createdAt || '-'}`,
        `status=${entry.status || '-'}`,
        `prompt="${truncateText(entry.prompt, 80)}"`
      ].join(' ')
    );
  }

  logStep(`Registry: ${options.registryPath}`);
}

async function commandRecordStatus(args) {
  const options = parseCommonOptions(args);
  const trackedEntry = selectTrackedEntry(loadRegistryEntries(options.registryPath), args);

  if (!trackedEntry && !args['record-id']) {
    throw new Error('The record-status command requires --record-id or --character-id.');
  }

  const target = trackedEntry || {
    recordId: args['record-id'],
    tool: args.tool || null,
    characterId: args['character-id'] || null,
    createdAt: null,
    prompt: null,
    status: null
  };

  if (!target.recordId) {
    throw new Error('Could not resolve a record id to inspect.');
  }

  logStep(
    [
      `Checking recordId=${target.recordId}`,
      `tool=${target.tool || args.tool || 'auto'}`,
      `characterId=${target.characterId || '-'}`,
      `createdAt=${target.createdAt || '-'}`,
      `status=${target.status || '-'}`
    ].join(' ')
  );

  const context = await launchContext(options);

  try {
    const page = await getMainPage(context);
    const toolCandidates = buildToolCandidates(target.tool || args.tool || null);
    const located = await locateRecordAcrossTools(page, target.recordId, toolCandidates);
    const historyEntry = await fetchHistoryEntry(page, target.recordId).catch(() => null);
    const tool = inferToolFromHistoryEntry(historyEntry) || located.tool;

    if (!located.record && !historyEntry) {
      const snapshot = await saveSnapshot(page, options.artifactsDir, `record-status-${safeSlug(target.recordId)}`);
      throw new Error(`Could not find record ${target.recordId}. Inspect ${snapshot.jsonPath}`);
    }

    const summary = summarizeRecordStatus(target.recordId, tool, located.record, historyEntry);
    logStep(`recordId=${summary.recordId} tool=${summary.tool} status=${summary.status || '-'} source=${summary.source}`);
    if (summary.progressPercent !== null) {
      logStep(`progressPercent=${summary.progressPercent}`);
    }
    if (summary.queuePosition !== null || summary.queueTotal !== null || summary.etaText) {
      logStep(
        [
          `queue=${summary.queuePosition ?? '-'}/${summary.queueTotal ?? '-'}`,
          `eta=${summary.etaText || '-'}`
        ].join(' ')
      );
    }
    if (summary.auditFailureType || summary.failureReason) {
      logStep(
        [
          `auditFailureType=${summary.auditFailureType || '-'}`,
          `auditFailurePhase=${summary.auditFailurePhase || '-'}`,
          `reason=${summary.failureReason || '-'}`
        ].join(' ')
      );
    }

    maybeEmitJson(args, summary);
  } finally {
    await context.close();
  }
}

async function commandFindRecord(args) {
  const options = parseCommonOptions(args);
  const trackedEntry = selectTrackedEntry(loadRegistryEntries(options.registryPath), args);

  if (!trackedEntry && !args['record-id']) {
    throw new Error('The find-record command requires --record-id or --character-id.');
  }

  const target = trackedEntry || {
    recordId: args['record-id'],
    tool: args.tool || null,
    characterId: args['character-id'] || null,
    createdAt: null,
    prompt: null,
    status: null
  };

  if (!target.recordId) {
    throw new Error('Could not resolve a record id to inspect.');
  }

  logStep(
    [
      `Looking for recordId=${target.recordId}`,
      `tool=${target.tool || args.tool || 'auto'}`,
      `characterId=${target.characterId || '-'}`,
      `createdAt=${target.createdAt || '-'}`,
      `status=${target.status || '-'}`
    ].join(' ')
  );

  const context = await launchContext(options);

  try {
    const page = await getMainPage(context);
    const toolCandidates = buildToolCandidates(target.tool || args.tool || null);
    const located = await locateRecordAcrossTools(page, target.recordId, toolCandidates);
    const locator = located.record?.locator || null;
    if (!locator) {
      const historyEntry = await fetchHistoryEntry(page, target.recordId).catch(() => null);
      if (historyEntry) {
        const resolvedTool = inferToolFromHistoryEntry(historyEntry) || located.tool;
        const historyStatus = historyEntryStatusLabel(historyEntry) || '-';
        const historyPath = artifactPath(options.artifactsDir, `find-record-${safeSlug(target.recordId)}-history`, 'json');
        fs.writeFileSync(historyPath, JSON.stringify(historyEntry, null, 2));
        logStep(`Found recordId=${target.recordId} via history-api tool=${resolvedTool} status=${historyStatus}`);
        logStep(`History record id: ${historyEntry.history_record_id || historyEntry.task?.history_id || '-'}`);
        logStep(`History JSON: ${historyPath}`);
        return;
      }

      const loadedCards = await collectLoadedRecordCards(page, 20);
      const snapshot = await saveSnapshot(page, options.artifactsDir, `find-record-${safeSlug(target.recordId)}`);
      logStep(`Record ${target.recordId} was not found on tools ${toolCandidates.join(', ')}. Saved snapshot: ${snapshot.screenshot}`);
      if (loadedCards.length) {
        logStep(`Loaded card ids: ${loadedCards.map((card) => card.recordId).join(', ')}`);
      }
      return;
    }

    const cardText = normalizeWhitespace(await locator.innerText().catch(() => ''));
    const cardStatus = inferRecordStatus(cardText);
    const screenshot = artifactPath(options.artifactsDir, `record-${safeSlug(target.recordId)}`, 'png');
    await locator.screenshot({ path: screenshot });
    logStep(`Found recordId=${target.recordId} tool=${located.tool} status=${cardStatus || '-'}`);
    logStep(`Card text: ${truncateText(cardText, 200)}`);
    logStep(`Card screenshot: ${screenshot}`);
  } finally {
    await context.close();
  }
}

async function commandDownloadRecord(args) {
  const options = parseCommonOptions(args);
  const trackedEntry = selectTrackedEntry(loadRegistryEntries(options.registryPath), args);

  if (!trackedEntry && !args['record-id']) {
    throw new Error('The download-record command requires --record-id or --character-id.');
  }

  const target = trackedEntry || {
    recordId: args['record-id'],
    tool: args.tool || null,
    characterId: args['character-id'] || null
  };

  if (!target.recordId) {
    throw new Error('Could not resolve a record id to download.');
  }

  const waitComplete = boolFlag(args['wait-complete'], true);
  const pollIntervalMs = integerFlag(args['poll-interval-ms'], 15000);
  const waitTimeoutMs = integerFlag(args['wait-timeout-ms'], 900000);
  const outputDir = path.resolve(
    args['output-dir'] || path.join(options.artifactsDir, `record-${safeSlug(target.recordId)}`)
  );

  logStep(
    [
      `Downloading recordId=${target.recordId}`,
      `tool=${target.tool || args.tool || 'auto'}`,
      `characterId=${target.characterId || '-'}`,
      `outputDir=${outputDir}`
    ].join(' ')
  );

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled']
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });
  context.setDefaultTimeout(45000);

  try {
    const page = await getMainPage(context);
    const toolCandidates = buildToolCandidates(target.tool || args.tool || null);
    const located = await locateRecordAcrossTools(page, target.recordId, toolCandidates);
    let tool = located.tool;
    let record = located.record;
    let historyEntry = await fetchHistoryEntry(page, target.recordId).catch(() => null);
    tool = inferToolFromHistoryEntry(historyEntry) || tool;

    if (waitComplete && (!recordIsComplete(record, tool) && !historyEntryIsComplete(historyEntry, tool))) {
      const waited = await waitForRecordCompletion(page, target.recordId, tool, waitTimeoutMs, pollIntervalMs);
      record = waited.record;
      historyEntry = waited.historyEntry || historyEntry;
      tool = waited.tool || tool;
    }

    if (!record && !historyEntry) {
      const snapshot = await saveSnapshot(page, options.artifactsDir, `download-record-${safeSlug(target.recordId)}`);
      throw new Error(`Could not find a complete record for ${target.recordId}. Inspect ${snapshot.jsonPath}`);
    }

    const domComplete = recordIsComplete(record, tool);
    const apiComplete = historyEntryIsComplete(historyEntry, tool);
    const currentStatus = historyEntryStatusLabel(historyEntry) || record?.status || '-';
    if (!domComplete && record && isFailureStatus(record.status)) {
      throw new Error(`Record ${target.recordId} failed: ${truncateText(record.text, 200)}`);
    }
    const historyFailure = historyEntryFailureMessage(historyEntry);
    if (!domComplete && !apiComplete && historyFailure) {
      throw new Error(`Record ${target.recordId} failed: ${historyFailure}`);
    }
    if (!domComplete && !apiComplete) {
      throw new Error(`Record ${target.recordId} is not complete yet. Current status: ${currentStatus}`);
    }

    const downloads = [];
    const baseName = safeSlug(target.recordId, 'record');
    let downloadSource = 'dom';
    if (apiComplete && !domComplete) {
      const apiDownloads = await saveHistoryEntryFiles(historyEntry, tool, outputDir, baseName);
      downloads.push(...apiDownloads);
      downloadSource = 'history-api';
      for (const saved of apiDownloads) {
        const label = tool === 'video'
          ? `Downloaded video 1/1 via history API: ${saved.filePath}`
          : `Downloaded image ${saved.index + 1}/${apiDownloads.length} via history API: ${saved.filePath}`;
        logStep(label);
      }
    } else {
      if (tool === 'video') {
        if (record.videos.length < 1) {
          throw new Error(`Record ${target.recordId} did not expose a playable video source.`);
        }

        await record.locator.scrollIntoViewIfNeeded().catch(() => null);
        await openVideoDetailFromCard(page, record.locator);
        const saved = await saveCurrentVideo(page, outputDir, baseName);
        downloads.push(saved);
        logStep(`Downloaded video 1/1: ${saved.filePath}`);
      } else {
        if (record.thumbnails.length < 4) {
          throw new Error(`Record ${target.recordId} exposed only ${record.thumbnails.length} result thumbnails.`);
        }

        for (let i = 0; i < 4; i += 1) {
          await record.locator.scrollIntoViewIfNeeded().catch(() => null);
          await openResultViewerFromCard(record.locator, i);
          const saved = await saveCurrentViewerImage(page, outputDir, baseName, i);
          downloads.push(saved);
          logStep(`Downloaded image ${i + 1}/4: ${saved.filePath}`);
          await closeViewer(page);
        }
      }
    }

    const metadataPath = path.join(outputDir, 'record-download.json');
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          recordId: target.recordId,
          tool,
          downloadedAt: isoTimestamp(),
          status: currentStatus,
          historyRecordId: historyEntry?.history_record_id || historyEntry?.task?.history_id || null,
          downloadSource,
          files: downloads
        },
        null,
        2
      )
    );

    maybeEmitJson(args, {
      ok: true,
      command: 'download-record',
      recordId: target.recordId,
      tool,
      outputDir,
      metadataPath,
      downloadSource,
      fileCount: downloads.length,
      files: downloads
    });
  } finally {
    await context.close();
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/jimeng-browser.js login [--headless true|false] [--timeout-ms 180000]
  node scripts/jimeng-browser.js snapshot [--tool home|image|video|canvas]
  node scripts/jimeng-browser.js open-tool [--tool home|image|video|canvas]
  node scripts/jimeng-browser.js generate --tool image|video --prompt "..." [--character-id alice] [--model "图片5.0 Lite"| "Seedance 2.0 Fast"] [--aspect "1:1"| "16:9"] [--resolution "高清 2K"| "720P"] [--duration "5s"] [--reference-mode "全能参考"] [--reference-file /abs/path]
  node scripts/jimeng-browser.js list-records [--tool image|video] [--character-id alice] [--limit 20]
  node scripts/jimeng-browser.js record-status --record-id <id> [--tool image|video]
  node scripts/jimeng-browser.js find-record --record-id <id> [--tool image|video]
  node scripts/jimeng-browser.js find-record --character-id alice [--tool image|video]
  node scripts/jimeng-browser.js download-record --record-id <id> [--tool image|video] [--output-dir /abs/path]

Optional flags:
  --user-data-dir /abs/path
  --artifacts-dir /abs/path
  --registry-path /abs/path.jsonl
  --headless true|false
  --json true|false
  --timeout-ms 180000
  --character-id alice
  --model "图片5.0 Lite"
  --aspect "1:1"
  --resolution "高清 2K"
  --duration "5s"
  --reference-mode "全能参考"|"首尾帧"|"智能多帧"|"主体参考"
  --first-frame-file /abs/path.png
  --last-frame-file /abs/path.png
  --submit-retries 2
  --submit-retry-delay-ms 60000
  --record-id-wait-ms 180000
  --wait-complete true|false
  --wait-timeout-ms 900000
  --poll-interval-ms 15000
  --output-dir /abs/path
  --reference-file /abs/path[,/abs/path2]
  --image-file /abs/path[,/abs/path2]`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  setJsonOutput(boolFlag(args.json, false));

  switch (command) {
    case 'login':
      await commandLogin(args);
      return;
    case 'snapshot':
      await commandSnapshot(args);
      return;
    case 'open-tool':
      await commandOpenTool(args);
      return;
    case 'generate':
      await commandGenerate(args);
      return;
    case 'list-records':
      await commandListRecords(args);
      return;
    case 'find-record':
      await commandFindRecord(args);
      return;
    case 'record-status':
      await commandRecordStatus(args);
      return;
    case 'download-record':
      await commandDownloadRecord(args);
      return;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  if (JSON_OUTPUT) {
    process.exitCode = 1;
    emitJson({
      ok: false,
      error: error.message
    });
    return;
  }
  console.error(`[jimeng] ${error.message}`);
  process.exitCode = 1;
});
