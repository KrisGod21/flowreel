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

  // One shared list of "this is clickable" for both the label lookup and the
  // recorded box - they used to drift, which meant a click on an icon inside a
  // <summary> recorded the summary's label but the icon's tiny box.
  const CLICKABLE = 'button, a, [role="button"], input[type="submit"], input[type="button"], summary';
  const BUTTON_SELECTOR = 'button, input[type="submit"], input[type="button"], [role="button"]';

  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s;

  // Escapes a value going inside a double-quoted CSS attribute selector
  // (tag[name="..."]), same order as serialize.ts's quote(): backslash first,
  // then the quote itself, so a value like Say "hi" cannot break out of the
  // selector's quotes. Every backslash below is doubled because this whole
  // file is itself one big template literal - each \\\\ here is one literal
  // backslash by the time this code runs in the browser.
  const escapeAttr = (s) => s.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');

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
    // The whitespace collapse below already removes every newline, so a
    // separate "no newline" check afterward can never fire.
    const text = (raw || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return text.length > 0 && text.length <= MAX_TEXT ? text : '';
  };

  // Bare text is only safe to emit when the resolver's own lookup strategy
  // (getByRole('button', exact) for button-like things, getByText(exact)
  // otherwise) would land on exactly one element - otherwise replay picks
  // whichever match happens to come first in the DOM, which may not be this one.
  const isButtonLike = (el) => el.matches(BUTTON_SELECTOR);

  const countButtonMatches = (label) => {
    const all = document.querySelectorAll(BUTTON_SELECTOR);
    let count = 0;
    for (let i = 0; i < all.length; i++) if (shortText(all[i]) === label) count++;
    return count;
  };

  // Mirrors getByText(exact): count elements whose *own* text equals the
  // label, skipping an element that merely contains a descendant with the
  // same exact text (that descendant is the real match, not its ancestor).
  const countTextMatches = (label) => {
    const all = document.querySelectorAll('*');
    let count = 0;
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (shortText(el) !== label) continue;
      const descendants = el.querySelectorAll('*');
      let hasMatchingDescendant = false;
      for (let j = 0; j < descendants.length; j++) {
        if (shortText(descendants[j]) === label) { hasMatchingDescendant = true; break; }
      }
      if (!hasMatchingDescendant) count++;
    }
    return count;
  };

  const isTextUnique = (clickable, label) =>
    (isButtonLike(clickable) ? countButtonMatches(label) : countTextMatches(label)) === 1;

  const describe = (el) => {
    const clickable = el.closest(CLICKABLE);
    const target = clickable || el;
    const label = shortText(target);
    if (clickable && label && isTextUnique(clickable, label)) return { target: label, label: label };
    if (target.id) return { target: '#' + cssEscape(target.id), label: label };
    const name = target.getAttribute('name');
    if (name) return { target: target.tagName.toLowerCase() + '[name="' + escapeAttr(name) + '"]', label: label };
    const placeholder = target.getAttribute('placeholder');
    if (placeholder) return { target: target.tagName.toLowerCase() + '[placeholder="' + escapeAttr(placeholder) + '"]', label: label };
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
    send({ type: 'click', target: d.target, label: d.label, box: boxOf(el.closest(CLICKABLE) || el), at: now() });
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
    // Top-centre, not a corner: real apps put toasts and notifications in
    // corners (this demo's own toast sits at right:26px;bottom:26px), so a
    // recorder that camps in a corner risks covering the app's own feedback.
    host.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;';
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
