# Self-Repair Guide: Diagnosing UI Breakage After JiMeng Updates

JiMeng updates its frontend frequently. CSS class names are hashed and change without notice.
This guide documents how to diagnose and fix selector breakage using browser DevTools.

---

## How breakage happens

The automation locates elements by CSS class fragments like `class*="submit-button-"` or
`class*="dimension-layout-"`. JiMeng's build system appends random hashes to class names
(e.g. `submit-button-dp8iME`). The fragment pattern survives most updates — but the
**structural class** (e.g. `default-layout-`) can be renamed entirely when the component is
refactored, silently breaking all selectors that depend on it.

---

## Recognising the symptom

| Error message | Likely broken selector |
|---|---|
| `The canvas conversation tool did not switch to 图片生成` | `getActiveGeneratorRoot` — scope fallback to `page` |
| `Could not find the image aspect/resolution toolbar button` | `getActiveGeneratorRoot` or toolbar click logic |
| `Could not find the canvas project conversation editor` | `findCanvasPromptEditor` |
| `Could not switch the canvas conversation tool to ...` | `chooseVisibleSelectOption` combobox scan |

If the error fires consistently and was not present before a JiMeng deploy, assume a selector
has been renamed.

---

## Step 1 — Identify the broken selector

Open the relevant function in [scripts/jimeng-browser.js](../scripts/jimeng-browser.js) and
find the CSS selector it uses. Common ones:

- `getActiveGeneratorRoot` (line ~631): `button[class*="submit-button-"]`, ancestor
  `div[class*="dimension-layout-"][class*="canvas-layout-"]`
- `configureAspectResolution` (line ~3274): `button[class*="toolbar-button-"]`
- `chooseVisibleSelectOption` (line ~3085): `.lv-select[role="combobox"]`
- `waitForCanvasConversationTool` (line ~3379): `.lv-select[role="combobox"]`, text `图片生成`

---

## Step 2 — Verify the selector in DevTools

Open the JiMeng canvas project page in the browser the daemon controls (default port 9222,
or just open a normal browser tab and log in manually for inspection).

Run the failing selector in the console and check the result:

```js
// Example: verify getActiveGeneratorRoot's anchor
document.querySelectorAll('button[class*="submit-button-"]').length
// Expected: > 0

// Verify the ancestor container
document.querySelector('button[class*="submit-button-"]')
  ?.closest('div[class*="dimension-layout-"][class*="canvas-layout-"]')
// Expected: a div element, not null
```

If the result is `0` or `null`, the selector is broken.

---

## Step 3 — Find the new selector

Walk up the DOM from a known stable element to find the new class name.

```js
// Walk up from submit button to find the new container class
(() => {
  const btn = document.querySelector('button[class*="submit-button-"]');
  let el = btn?.parentElement;
  const chain = [];
  while (el && chain.length < 8) {
    const box = el.getBoundingClientRect();
    chain.push({ class: el.className, w: Math.round(box.width), h: Math.round(box.height) });
    el = el.parentElement;
  }
  return chain;
})()
```

Look for the ancestor that:
- Has a meaningful width/height (not 0)
- Contains the fragment you expected (e.g. `dimension-layout-`)
- Has a new companion class where you previously had `default-layout-` or similar

---

## Step 4 — Verify the click works before patching

Before editing the code, confirm the interaction works manually in the console:

```js
// Example: verify toolbar button click opens the popover
document.querySelector('button[class*="toolbar-button-"]').click()
// Then check:
document.querySelectorAll('.lv-popover-content [role="radiogroup"]').length
// Expected: > 0
```

Also verify combobox switching:

```js
// Open dropdown
document.querySelector('.lv-select[role="combobox"]').click()
// Pick option
Array.from(document.querySelectorAll('[role="option"]'))
  .find(el => el.innerText.trim() === '图片生成')?.click()
// Confirm
document.querySelector('.lv-select[role="combobox"]').innerText.trim()
// Expected: '图片生成'
```

---

## Step 5 — Apply the fix

Update the selector in `scripts/jimeng-browser.js`. Common fix patterns:

**Ancestor class rename** (most common):
```js
// Before
button.locator('xpath=ancestor::div[contains(@class,"dimension-layout-") and contains(@class,"default-layout-")][1]')
// After — replace the renamed class
button.locator('xpath=ancestor::div[contains(@class,"dimension-layout-") and contains(@class,"canvas-layout-")][1]')
```

**Double-click cancelling itself** (popover opens then closes):
```js
// Wrong — two clicks toggle the popover off
await button.click({ force: true })
await button.evaluate(node => node.click())  // removes this line

// Correct — single click
await button.click({ force: true })
```

---

## Step 6 — Test

Kill the daemon so it reloads the new code, then run a test task:

```bash
pkill -f "jimeng-browser.js"
node scripts/jimeng-browser.js canvas-prompt \
  --project-id <project-id> \
  --kind image \
  --prompt "测试图：白底简洁插画。" \
  --aspect 1:1
```

Run 3 consecutive tasks to confirm stability.

---

## Quick-reference: key selectors and their roles

| Selector | Role | Function |
|---|---|---|
| `button[class*="submit-button-"]` | Anchor for finding the active input root | `getActiveGeneratorRoot` |
| `div[class*="dimension-layout-"][class*="canvas-layout-"]` | Active input area root container | `getActiveGeneratorRoot` |
| `.lv-select[role="combobox"]` | Tool switcher dropdown (图片生成 / 视频生成) | `chooseVisibleSelectOption`, `waitForCanvasConversationTool` |
| `button[class*="toolbar-button-"]` | Aspect ratio / resolution button | `configureAspectResolution` |
| `.lv-popover-content [role="radiogroup"]` | Aspect/resolution option panel | `configureAspectResolution` |
| `[role="option"]` | Dropdown options inside `.lv-select-popup` | `chooseVisibleSelectOption` |

---

## Changelog

| Date | Broken selector | New selector | Function |
|---|---|---|---|
| 2026-04-16 | `div[class*="default-layout-"]` | `div[class*="canvas-layout-"]` | `getActiveGeneratorRoot` |
| 2026-04-16 | double `click` on toolbar button | single `click({force:true})` | `configureAspectResolution` |
