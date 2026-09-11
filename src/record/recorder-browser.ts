// Injected into every document while recording. Self-contained JavaScript in a
// string: no imports, no TypeScript. It reports each interaction to Node via
// window.__flowreelEvent, which page.exposeFunction makes survive navigation.
//
// A raw backtick anywhere inside this string breaks the outer template literal
// and silently kills the recorder. Never write one in a comment here.
export const RECORDER_SOURCE = `
(() => {
  if (window.__flowreelRecorder) return;

  const MAX_TEXT = 40;
  const send = (event) => { try { window.__flowreelEvent(event); } catch (e) {} };
  const now = () => performance.now();

  const isStopButton = (el) => !!(el && el.closest && el.closest('[data-flowreel-stop]'));

  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s;

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
      const siblings = Array.from(node.parentNode ? node.parentNode.children : []).filter((s) => s.tagName === node.tagName);
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const shortText = (el) => {
    const raw = el.innerText != null ? el.innerText : (el.textContent || '');
    const text = (raw || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return text.length > 0 && text.length <= MAX_TEXT && !text.includes('\\n') ? text : '';
  };

  const describe = (el) => {
    const clickable = el.closest('button, a, [role="button"], input[type="submit"], input[type="button"], summary');
    const target = clickable || el;
    const label = shortText(target);
    if (clickable && label) return { target: label, label: label };
    if (target.id) return { target: '#' + cssEscape(target.id), label: label };
    const name = target.getAttribute('name');
    if (name) return { target: target.tagName.toLowerCase() + '[name="' + name + '"]', label: label };
    const placeholder = target.getAttribute('placeholder');
    if (placeholder) return { target: target.tagName.toLowerCase() + '[placeholder="' + placeholder + '"]', label: label };
    return { target: cssPath(target), label: label };
  };

  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  // Typing is coalesced: one input event per focus session, carrying the final
  // value, flushed when focus leaves or a non-typing event arrives.
  let pending = null;
  const flushInput = () => {
    if (!pending) return;
    send({ type: 'input', target: pending.target, value: pending.el.value, box: boxOf(pending.el), at: pending.at });
    pending = null;
  };

  const isTextField = (el) =>
    el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file|range|color)$/i.test(el.type)) || el.isContentEditable);

  document.addEventListener('click', (e) => {
    const el = e.composedPath()[0];
    if (!el || el.nodeType !== 1 || isStopButton(el)) return;
    if (isTextField(el)) return; // focusing a field is not a demo step; typing into it is
    flushInput();
    const d = describe(el);
    send({ type: 'click', target: d.target, label: d.label, box: boxOf(el.closest('button, a, [role="button"]') || el), at: now() });
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isTextField(el) || isStopButton(el)) return;
    if (!pending || pending.el !== el) {
      flushInput();
      pending = { el: el, target: describe(el).target, at: now() };
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    if (pending && e.target === pending.el) flushInput();
  }, true);

  const PRESS_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  document.addEventListener('keydown', (e) => {
    if (!PRESS_KEYS.has(e.key) || isStopButton(e.target)) return;
    flushInput();
    send({ type: 'press', key: e.key, at: now() });
  }, true);

  let scrollAccum = 0;
  let scrollTimer = null;
  let scrollAt = 0;
  window.addEventListener('wheel', (e) => {
    if (isStopButton(e.target)) return;
    if (scrollTimer === null) scrollAt = now();
    scrollAccum += e.deltaY;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      flushInput();
      if (Math.abs(scrollAccum) >= 40) send({ type: 'scroll', deltaY: scrollAccum, at: scrollAt });
      scrollAccum = 0;
      scrollTimer = null;
    }, 250);
  }, { passive: true, capture: true });

  window.addEventListener('pagehide', flushInput);

  window.__flowreelRecorder = { describe: describe, flush: flushInput };

  const mountStop = () => {
    if (document.querySelector('[data-flowreel-stop]')) return;
    const host = document.createElement('div');
    host.setAttribute('data-flowreel-stop', '');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>' +
      'button{all:initial;cursor:pointer;font:600 14px ui-sans-serif,system-ui,sans-serif;color:#fff;' +
      'background:#e5484d;padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);' +
      'display:inline-flex;align-items:center;gap:8px}' +
      'button:hover{background:#d13b40}' +
      'i{width:10px;height:10px;border-radius:50%;background:#fff;display:inline-block}' +
      '</style>' +
      '<button type="button"><i></i>Stop recording</button>';
    root.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.__flowreelStop(); } catch (err) {}
    });
    (document.body || document.documentElement).appendChild(host);
  };
  if (document.body) mountStop();
  else document.addEventListener('DOMContentLoaded', mountStop, { once: true });
})();
`;
