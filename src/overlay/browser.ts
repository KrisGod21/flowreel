// This string is injected into every document via page.addInitScript. It must be
// self-contained: no imports, no TypeScript, no reliance on anything in the app.
//
// The root is a CLOSED shadow root on purpose. Playwright's locators pierce open
// shadow roots, which would make caption text a click target and pollute the
// "visible buttons" list in a not-found error. A closed root is unreachable from
// document.querySelector and from every locator, so the isolation is structural
// rather than something callers must remember to filter for.
//
// Because a closed root is also unreachable from page.evaluate, the handle is
// published on window.__flowreelOverlay. That is how the Node side drives it and
// how tests inspect it.
export const OVERLAY_SOURCE = `
(() => {
  if (window.__flowreelOverlay) return;

  const install = () => {
    if (!document.documentElement || window.__flowreelOverlay) return;

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');

    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = \`
      <style>
        :host { all: initial; }
        .fr-cursor {
          position: fixed; top: 0; left: 0; width: 22px; height: 22px;
          margin: -2px 0 0 -2px; opacity: 0; transition: opacity 160ms ease;
          will-change: transform;
        }
        .fr-cursor svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
        .fr-ripple {
          position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px;
          border-radius: 50%; border: 2px solid rgba(56,132,255,.9);
          background: rgba(56,132,255,.18); opacity: 0; transform: scale(1);
        }
        .fr-chip {
          position: fixed; transform: translate(-50%, -140%);
          font: 600 13px/1.4 ui-sans-serif, system-ui, sans-serif;
          color: #fff; background: rgba(20,22,28,.92); padding: 4px 9px;
          border-radius: 7px; white-space: pre; opacity: 0;
        }
        .fr-caption {
          position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
          max-width: 78%; text-align: center;
          font: 600 17px/1.45 ui-sans-serif, system-ui, sans-serif;
          color: #fff; background: rgba(16,18,24,.88); padding: 10px 18px;
          border-radius: 11px; opacity: 0; transition: opacity 220ms ease;
        }
        .fr-highlight {
          position: fixed; border-radius: 8px; opacity: 0;
          box-shadow: 0 0 0 3px rgba(56,132,255,.95), 0 0 0 9999px rgba(6,8,12,.42);
          transition: opacity 220ms ease;
        }
      </style>
      <div class="fr-highlight"></div>
      <div class="fr-caption"></div>
      <div class="fr-cursor">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 2 L4 17 L8.2 13.2 L10.8 19 L13.6 17.8 L11 12.2 L16.4 12.2 Z"
                fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
      </div>
    \`;

    document.documentElement.appendChild(host);

    const el = (selector) => root.querySelector(selector);
    const cursor = el('.fr-cursor');
    const caption = el('.fr-caption');
    const highlight = el('.fr-highlight');
    const state = { x: 0, y: 0 };

    const api = {
      cursorAt: () => ({ x: state.x, y: state.y }),

      showCursor(show) {
        cursor.style.opacity = show ? '1' : '0';
      },

      placeCursor(x, y) {
        state.x = x; state.y = y;
        cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      },

      captionText: () => caption.textContent || '',

      setCaption(text) {
        caption.textContent = text;
        caption.style.opacity = text ? '1' : '0';
      },

      highlightRect: (rect) => {
        if (!rect) { highlight.style.opacity = '0'; return; }
        highlight.style.left = rect.x + 'px';
        highlight.style.top = rect.y + 'px';
        highlight.style.width = rect.width + 'px';
        highlight.style.height = rect.height + 'px';
        highlight.style.opacity = '1';
      },

      ripple(x, y, ms) {
        const node = document.createElement('div');
        node.className = 'fr-ripple';
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        root.appendChild(node);
        const remove = () => node.remove();
        node.animate(
          [
            { opacity: 0.95, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(3.6)' },
          ],
          { duration: ms, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' },
        ).finished.catch(() => {}).then(remove);
        // Belt and braces: the Web Animations finished promise resolves on a
        // timeline tick, which can be delayed well past the animation's end under
        // load. Node.remove() is a documented no-op on an already-detached node, so
        // whichever path fires second does nothing.
        setTimeout(remove, ms + 400);
      },

      chip(text, x, y, ms) {
        const node = document.createElement('div');
        node.className = 'fr-chip';
        node.textContent = text;
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        root.appendChild(node);
        const remove = () => node.remove();
        node.animate(
          [
            { opacity: 0, transform: 'translate(-50%,-120%)' },
            { opacity: 1, transform: 'translate(-50%,-150%)', offset: 0.25 },
            { opacity: 1, transform: 'translate(-50%,-150%)', offset: 0.7 },
            { opacity: 0, transform: 'translate(-50%,-185%)' },
          ],
          { duration: ms, easing: 'ease-out', fill: 'forwards' },
        ).finished.catch(() => {}).then(remove);
        // Belt and braces: the Web Animations finished promise resolves on a
        // timeline tick, which can be delayed well past the animation's end under
        // load. Node.remove() is a documented no-op on an already-detached node, so
        // whichever path fires second does nothing.
        setTimeout(remove, ms + 400);
      },

      setZoom(scale, originX, originY, ms) {
        const doc = document.documentElement;
        doc.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.2,1)';
        doc.style.transformOrigin = originX + 'px ' + originY + 'px';
        doc.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
      },
    };

    window.__flowreelOverlay = { root, api };
  };

  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
`;
