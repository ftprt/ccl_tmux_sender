let selectedTarget = null;
let panes = [];
let pollTimer = null;
let promptBadgeShown = {};  // target -> true (tracks which panes already showed the badge animation)
let lastPromptActionsKey = '';  // diff key to skip redundant DOM updates
let captureTimer = null;
const paneScrollState = {};  // { [target]: { scrollTop, userScrolledAway } }

// Detect user scroll: pause auto-scroll when scrolled away from bottom,
// resume when user scrolls back to the bottom. Save state per pane.
document.getElementById('preview-textarea').addEventListener('scroll', function() {
  if (!selectedTarget) return;
  const el = this;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  if (!paneScrollState[selectedTarget]) paneScrollState[selectedTarget] = {};
  paneScrollState[selectedTarget].scrollTop = el.scrollTop;
  paneScrollState[selectedTarget].userScrolledAway = !atBottom;
  document.getElementById('scroll-to-bottom-btn').style.display = atBottom ? 'none' : 'flex';
});

function scrollToBottom() {
  const textarea = document.getElementById('preview-textarea');
  textarea.scrollTop = textarea.scrollHeight;
  if (selectedTarget && paneScrollState[selectedTarget]) {
    paneScrollState[selectedTarget].userScrolledAway = false;
  }
  document.getElementById('scroll-to-bottom-btn').style.display = 'none';
}

async function loadPanes() {
  try {
    const res = await fetch('/api/panes');
    const data = await res.json();
    if (Array.isArray(data)) {
      panes = data;
      renderPanes();
    } else if (data.panes) {
      panes = data.panes;
      renderPanes();
      renderRateLimits(data.rate_limits);
    } else {
      document.getElementById('pane-grid').innerHTML =
        '<div class="empty-state">Error: ' + esc(data.error || JSON.stringify(data)) + '</div>';
    }
  } catch (e) {
    document.getElementById('pane-grid').innerHTML =
      '<div class="empty-state">Failed to load panes: ' + esc(String(e)) + '</div>';
  }
}

function renderPanes() {
  const grid = document.getElementById('pane-grid');
  if (panes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No Claude Code panes found.</div>';
    return;
  }
  grid.innerHTML = panes.map(p => `
    <div class="pane-card ${p.target === selectedTarget ? 'selected' : ''}"
         onclick="selectPane('${p.target}')">
      <div class="target">${esc(p.target)}</div>
      <div class="cwd">${esc(p.cwd)}</div>
      <div class="meta">
        <span class="status-dot ${p.status}"></span>
        <span class="status-label">${p.status}</span>
        ${p.prompt_waiting ? `<span class="prompt-badge${!promptBadgeShown[p.target] ? ' animate' : ''}">INPUT</span>` : ''}
      </div>
      ${p.tokens ? `<div class="token-info">
        <span>${fmtTokens(p.tokens.input)}&#8593; ${fmtTokens(p.tokens.output)}&#8595;</span>
        <span>ctx ${p.tokens.ctx_pct.toFixed(0)}%</span>
        <div class="ctx-bar"><div class="ctx-bar-fill" style="width:${Math.min(p.tokens.ctx_pct, 100).toFixed(0)}%;background:${ctxColor(p.tokens.ctx_pct)}"></div></div>
      </div>` : ''}
    </div>
  `).join('');
  // Update badge animation tracking
  panes.forEach(p => {
    if (p.prompt_waiting) {
      promptBadgeShown[p.target] = true;
    } else {
      delete promptBadgeShown[p.target];  // reset so animation plays again next time
    }
  });
}

function selectPane(target) {
  // 切り替え前のペインのスクロール位置を保存
  if (selectedTarget) {
    const textarea = document.getElementById('preview-textarea');
    if (!paneScrollState[selectedTarget]) paneScrollState[selectedTarget] = {};
    paneScrollState[selectedTarget].scrollTop = textarea.scrollTop;
    const atBottom = textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight < 30;
    paneScrollState[selectedTarget].userScrolledAway = !atBottom;
  }
  selectedTarget = target;
  renderPanes();
  document.getElementById('selected-label').innerHTML =
    'Sending to: <strong>' + esc(target) + '</strong>';
  document.getElementById('preview-target').textContent = target;
  document.getElementById('prompt-input').disabled = false;
  document.getElementById('send-btn').disabled = false;
  document.querySelectorAll('#quick-buttons .quick-btn').forEach(b => b.disabled = false);
  document.querySelectorAll('#manual-keys .quick-btn').forEach(b => b.disabled = false);
  document.getElementById('custom-send-input').disabled = false;
  renderPresetButtons();
  document.getElementById('prompt-input').focus();
  loadCapture();
  startCapturePolling();
}

// --- Pane output capture ---
async function loadCapture() {
  if (!selectedTarget) return;
  try {
    const res = await fetch('/api/capture?target=' + encodeURIComponent(selectedTarget));
    const data = await res.json();
    const textarea = document.getElementById('preview-textarea');
    const empty = document.getElementById('preview-empty');
    if (data.ok) {
      textarea.style.display = '';
      empty.style.display = 'none';
      textarea.value = data.content;
      const state = paneScrollState[selectedTarget] || {};
      if (document.getElementById('auto-scroll').checked && !state.userScrolledAway) {
        textarea.scrollTop = textarea.scrollHeight;
      } else if (state.scrollTop !== undefined) {
        textarea.scrollTop = state.scrollTop;
      }
      // Prompt detection
      const lines = data.content.split('\n');
      const tail = lines.slice(-30);
      const detected = detectPrompt(tail);
      if (!detected) {
        promptActionSuppressedKey = '';   // options scrolled out of view — lift suppression
        renderPromptActions(null);
      } else {
        const detectedKey = (detected.title || '') + '|' + detected.options.map(o => o.label).join('|');
        if (detectedKey === promptActionSuppressedKey) {
          renderPromptActions(null);      // stale options already acted on — keep hidden
        } else {
          renderPromptActions(detected.options, detected.title);
        }
      }
    } else {
      textarea.style.display = 'none';
      empty.style.display = '';
      empty.textContent = data.error;
    }
  } catch (e) {
    // Silently ignore fetch errors for capture
  }
}

function startCapturePolling() {
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = setInterval(loadCapture, 2000);
}

// --- Mode / options ---
function getSelectedMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function getSendEnter() {
  return document.getElementById('send-enter').checked;
}

async function quickSend(command) {
  if (!selectedTarget) return;
  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: selectedTarget, prompt: command, send_enter: true })
    });
    const data = await res.json();
    const btn = document.getElementById('send-btn');
    if (data.ok) {
      flashBtn(btn, 'Sent!', 'sent');
    } else {
      flashBtn(btn, 'Failed', 'failed');
    }
  } catch (e) {
    const btn = document.getElementById('send-btn');
    flashBtn(btn, 'Error', 'failed');
  }
  setTimeout(loadCapture, 500);
}

// --- Custom preset buttons ---
const PRESETS_KEY = 'ccl_presets';
const RESIZER_KEY = 'ccl_resizer_h';
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; }
  catch { return []; }
}
function savePresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function renderPresetButtons() {
  const container = document.getElementById('preset-buttons');
  const presets = loadPresets();
  container.innerHTML = '';
  presets.forEach(preset => {
    const wrapper = document.createElement('span');
    wrapper.className = 'preset-btn-wrapper';
    const btn = document.createElement('button');
    btn.className = 'quick-btn preset-btn';
    btn.textContent = preset.label;
    btn.title = preset.text;
    btn.disabled = !selectedTarget;
    btn.onclick = () => quickSend(preset.text);
    const rm = document.createElement('button');
    rm.className = 'preset-remove-btn';
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.onclick = e => { e.stopPropagation(); removePreset(preset.id); };
    wrapper.appendChild(btn);
    wrapper.appendChild(rm);
    container.appendChild(wrapper);
  });
}

function removePreset(id) {
  savePresets(loadPresets().filter(p => p.id !== id));
  renderPresetButtons();
}

function savePreset() {
  const input = document.getElementById('custom-send-input');
  const text = input.value.trim();
  if (!text) {
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 800);
    return;
  }
  const presets = loadPresets();
  if (presets.length >= 20) { alert('Maximum 20 presets reached. Remove one first.'); return; }
  const label = text.slice(0, 20);
  presets.push({ id: Date.now().toString(), label, text });
  savePresets(presets);
  renderPresetButtons();
  input.value = '';
}

function customSend() {
  const text = document.getElementById('custom-send-input').value.trim();
  if (!text || !selectedTarget) return;
  quickSend(text);
}

async function sendPrompt() {
  const input = document.getElementById('prompt-input');
  const btn = document.getElementById('send-btn');
  const prompt = input.value.trim();

  if (!selectedTarget || !prompt) return;

  const targetMode = getSelectedMode() === 'plan' ? 'plan' : 'normal';
  const sendEnter = getSendEnter();

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: selectedTarget,
        prompt: prompt,
        target_mode: targetMode,
        send_enter: sendEnter,
      })
    });
    const data = await res.json();
    if (data.ok) {
      input.value = '';
      flashBtn(btn, 'Sent!', 'sent');
    } else {
      flashBtn(btn, 'Failed', 'failed');
    }
  } catch (e) {
    flashBtn(btn, 'Error', 'failed');
  } finally {
    btn.disabled = false;
  }

  setTimeout(loadPanes, 1000);
  setTimeout(loadCapture, 500);
}

function flashBtn(btn, label, cls) {
  btn.textContent = label;
  btn.classList.add(cls);
  setTimeout(() => {
    btn.textContent = 'Send';
    btn.classList.remove(cls);
  }, 1500);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function ctxColor(pct) {
  if (pct >= 80) return 'var(--red)';
  if (pct >= 50) return 'var(--yellow)';
  return 'var(--green)';
}

function renderRateLimits(rl) {
  const el = document.getElementById('rate-limits');
  if (!el) return;
  if (!rl) { el.innerHTML = ''; return; }
  const items = [
    { label: '5h', pct: rl.five_hour || 0 },
    { label: '7d', pct: rl.seven_day || 0 },
  ];
  el.innerHTML = items.map(i => `
    <div class="rl-item">
      <span class="rl-label">${i.label}</span>
      <div class="rl-bar"><div class="rl-bar-fill" style="width:${Math.min(i.pct, 100).toFixed(0)}%;background:${ctxColor(i.pct)}"></div></div>
      <span class="rl-pct">${i.pct.toFixed(0)}%</span>
    </div>
  `).join('');
}

// Ctrl+Enter / Cmd+Enter to send
document.getElementById('prompt-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPrompt();
  }
});

// Enter to send from custom one-shot input
document.getElementById('custom-send-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); customSend(); }
});

// --- Prompt detection engine ---
let promptActionSuppressedKey = '';  // fingerprint of actioned/dismissed options

/**
 * Detect interactive prompts from the tail of captured output.
 * Returns {title, options: [{num, label, selected, keys}]} or null.
 */
function detectPrompt(tailLines) {
  const tailText = tailLines.join('\n');

  // Primary signal 1: AskUserQuestion / completion menu
  const hasSelectFooter = tailText.includes('Enter to select');
  // Primary signal 2: Plan completion prompt
  const hasPlanFooter = tailText.includes('ctrl-g to edit') || tailText.includes('Would you like to proceed');
  // Primary signal 3: Tool permission (Allow + Deny)
  const hasPermission = /\bAllow\b/i.test(tailText) && /\bDeny\b/i.test(tailText);
  // Primary signal 4: Bash command / tool execution confirmation
  const hasBashConfirm = tailText.includes('Esc to cancel') && tailText.includes('Tab to amend');
  // Primary signal 5: Claude tool/fetch permission dialog ("Claude wants to ..." / "Do you want to allow")
  const hasClaudeDialog = /Claude wants to\b/i.test(tailText) || /Do you want to allow\b/i.test(tailText);

  if (!hasSelectFooter && !hasPlanFooter && !hasPermission && !hasBashConfirm && !hasClaudeDialog) return null;

  // Regex for numbered option lines (with or without ❯ selector)
  const optionRe = /^(\s*)(❯\s*)?\s*(\d+)\.\s+(.+)$/;

  // Find the anchor line: the line with ❯ + numbered option
  let anchorIdx = -1;
  for (let i = 0; i < tailLines.length; i++) {
    const m = tailLines[i].match(optionRe);
    if (m && m[2]) { // m[2] is the ❯ group
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx === -1) return null;

  // Scan BACKWARD from anchor to find the top of the option block.
  // Walk through option lines, description lines (deeply indented),
  // and blank lines. Stop at anything else (regular text, separators).
  let blockStart = anchorIdx;
  for (let i = anchorIdx - 1; i >= 0; i--) {
    const line = tailLines[i];
    if (optionRe.test(line)) {
      blockStart = i;                  // another option line → extend block
    } else if (line.trim() === '') {
      continue;                        // blank line → keep scanning
    } else if (/^\s{3,}\S/.test(line)) {
      continue;                        // description line (deeply indented) → keep scanning
    } else {
      break;                           // regular text / separator → block boundary
    }
  }

  // Forward limit: scan through separators (they are just visual dividers)
  const blockEnd = Math.min(tailLines.length - 1, anchorIdx + 30);

  // Extract options from blockStart..blockEnd (skip non-option lines)
  const options = [];
  let selectedNum = -1;  // track ❯ position by menu number (not filtered index)
  for (let i = blockStart; i <= blockEnd; i++) {
    const m = tailLines[i].match(optionRe);
    if (!m) continue;
    const isSelected = !!m[2];
    const num = parseInt(m[3]);
    const label = m[4].trim();
    if (isSelected) selectedNum = num;
    options.push({ num, label, selected: isSelected, keys: [] });
  }

  if (options.length === 0) return null;
  // Default selectedNum to first option if ❯ was on a filtered item
  if (selectedNum === -1) selectedNum = options[0].num;

  // Calculate key sequences using original menu numbers so navigation
  // is correct even when ❯ sits on a filtered option (e.g. "Type something")
  for (let i = 0; i < options.length; i++) {
    const delta = options[i].num - selectedNum;
    const keys = [];
    const dir = delta > 0 ? 'Down' : 'Up';
    for (let j = 0; j < Math.abs(delta); j++) keys.push(dir);
    keys.push('Enter');
    options[i].keys = keys;
  }

  // Build title
  let title = 'Action needed';
  if (hasBashConfirm) title = 'Command confirmation';
  else if (hasPlanFooter) title = 'Plan ready';
  else if (hasPermission) title = 'Permission needed';
  else if (hasClaudeDialog) title = 'Permission request';
  else if (hasSelectFooter) title = 'Select an option';

  return { title, options };
}

/**
 * Render prompt action buttons or hide the bar.
 */
function renderPromptActions(options, title) {
  const container = document.getElementById('prompt-actions');
  const btnContainer = document.getElementById('prompt-actions-buttons');

  if (!options || options.length === 0) {
    container.style.display = 'none';
    lastPromptActionsKey = '';
    return;
  }

  // Skip redundant DOM rebuild if options haven't changed
  const key = (title || '') + '|' + options.map(o => o.label).join('|');
  if (key === lastPromptActionsKey) return;
  lastPromptActionsKey = key;

  container.querySelector('.prompt-actions-label span').textContent = '\u26A1 ' + (title || 'Action needed');
  btnContainer.innerHTML = '';

  options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'prompt-action-btn';

    // Color-code by semantics
    if (/\b(yes|allow|ok|accept)\b/i.test(opt.label)) btn.classList.add('positive');
    if (/\b(no|deny|cancel|skip)\b/i.test(opt.label)) btn.classList.add('negative');

    const shortcutNum = idx + 1;
    btn.innerHTML = esc(opt.label) + ' <span class="shortcut">' + shortcutNum + '</span>';
    btn.onclick = () => sendPromptAction(opt.keys);
    btnContainer.appendChild(btn);
  });

  container.style.display = '';
  // Restart animation without forced reflow — use rAF double-frame
  container.classList.remove('pulse');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.classList.add('pulse');
    });
  });
}

function dismissPromptActions() {
  document.getElementById('prompt-actions').style.display = 'none';
  promptActionSuppressedKey = lastPromptActionsKey;
}

/**
 * Send raw key sequence to the selected pane via /api/send-keys.
 */
async function sendRawKeys(keys) {
  if (!selectedTarget || !keys || keys.length === 0) return;
  try {
    const res = await fetch('/api/send-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: selectedTarget, keys: keys })
    });
    const data = await res.json();
    if (data.ok) {
      flashBtn(document.getElementById('send-btn'), 'Sent!', 'sent');
    } else {
      flashBtn(document.getElementById('send-btn'), 'Failed', 'failed');
    }
  } catch (e) {
    flashBtn(document.getElementById('send-btn'), 'Error', 'failed');
  }
  setTimeout(loadCapture, 500);
  setTimeout(loadPanes, 1000);
}

/**
 * Send prompt action (arrow keys + Enter) and hide the action bar.
 */
async function sendPromptAction(keys) {
  promptActionSuppressedKey = lastPromptActionsKey;
  document.getElementById('prompt-actions').style.display = 'none';
  await sendRawKeys(keys);
}

// Keyboard shortcuts: number keys 1-9 to select prompt action options
// Only active when prompt actions are visible and textarea is not focused
document.addEventListener('keydown', function(e) {
  const actionsBar = document.getElementById('prompt-actions');
  if (actionsBar.style.display === 'none') return;
  if (document.activeElement === document.getElementById('prompt-input')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    dismissPromptActions();
    return;
  }

  const num = parseInt(e.key);
  if (num >= 1 && num <= 9) {
    const buttons = document.querySelectorAll('#prompt-actions-buttons .prompt-action-btn');
    if (num <= buttons.length) {
      e.preventDefault();
      buttons[num - 1].click();
    }
  }
});

// Portrait resizer: drag to resize between pane output and prompt input
(function() {
  const resizer = document.getElementById('v-resizer');
  const promptSec = document.querySelector('.prompt-section');
  let dragging = false, startY = 0, startH = 0;

  function isPortrait() { return window.innerHeight > window.innerWidth; }

  function handleMouseMove(e) { onMove(e.clientY); }
  function handleMouseUp() { onEnd(); document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); }

  function onStart(clientY) {
    if (!isPortrait()) return;
    dragging = true;
    startY = clientY;
    startH = promptSec.offsetHeight;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
  function onMove(clientY) {
    if (!dragging) return;
    const delta = startY - clientY; // 上ドラッグ = プロンプトを大きく
    const newH = Math.max(120, Math.min(window.innerHeight * 0.65, startH + delta));
    promptSec.style.height = newH + 'px';
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(RESIZER_KEY, String(promptSec.offsetHeight));
  }

  resizer.addEventListener('mousedown', e => { onStart(e.clientY); e.preventDefault(); });

  resizer.addEventListener('touchstart', e => { onStart(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (dragging) { onMove(e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('touchend', onEnd);

  // ページロード時に縦向きの場合、保存済み高さを復元
  if (isPortrait()) {
    const savedH = localStorage.getItem(RESIZER_KEY);
    if (savedH) promptSec.style.height = savedH + 'px';
  }

  // 向き変更時のリセット・復元
  window.matchMedia('(orientation: portrait)').addEventListener('change', e => {
    if (!e.matches) {
      promptSec.style.height = '';
    } else {
      const savedH = localStorage.getItem(RESIZER_KEY);
      if (savedH) promptSec.style.height = savedH + 'px';
    }
  });
})();

// PWA install button
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('pwa-install-btn').style.display = '';
});
document.getElementById('pwa-install-btn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') {
    document.getElementById('pwa-install-btn').style.display = 'none';
  }
});
window.addEventListener('appinstalled', () => {
  document.getElementById('pwa-install-btn').style.display = 'none';
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Touch mode toggle
const TOUCH_MODE_KEY = 'ccl_touch_mode';
function initTouchMode() {
  if (localStorage.getItem(TOUCH_MODE_KEY) === '1') {
    document.body.classList.add('touch-mode');
    document.getElementById('touch-mode-btn').textContent = 'Normal';
  }
}
function toggleTouchMode() {
  const enabled = document.body.classList.toggle('touch-mode');
  localStorage.setItem(TOUCH_MODE_KEY, enabled ? '1' : '0');
  document.getElementById('touch-mode-btn').textContent = enabled ? 'Normal' : 'Touch';
}

// Initial load + polling
initTouchMode();
loadPanes();
pollTimer = setInterval(loadPanes, 5000);
renderPresetButtons();
