// Shared browser-standard building blocks used across every PlanTrace
// component: DOM query shorthands, HTML escaping, a small app-wide message
// bus for cross-feature notifications (toasts, imports, saves, workflow
// navigation — per-edit chatter belongs on PlanDocumentStore instead, not
// here), a PtElement base class mirroring Panic Backstage's PanicElement,
// and a couple of shared dialog/toast primitives.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function titleCase(value) {
  return String(value || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ── App-wide message bus ────────────────────────────────────────────────────
// A plain EventTarget, not a global singleton with magic strings sprinkled
// everywhere — every publish/subscribe call site imports this one object.
class MessageBus extends EventTarget {
  publish(topic, detail = {}) { this.dispatchEvent(new CustomEvent(topic, { detail })); }
  subscribe(topic, handler, signal) { this.addEventListener(topic, (e) => handler(e.detail), { signal }); }
}
export const bus = new MessageBus();

export function toast(message, tone = 'info') { bus.publish('toast.show', { message, tone }); }

// ── Base element ─────────────────────────────────────────────────────────
// Mirrors Panic Backstage's PanicElement: allocate an AbortController on
// connect, call a component-specific connect(), and abort everything on
// disconnect so no component ever needs to manually track its own listeners.
export class PtElement extends HTMLElement {
  connectedCallback() {
    this.abort = new AbortController();
    this.connect?.();
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.disconnect?.();
  }

  setLoading(label = 'Loading…') {
    this.innerHTML = `<div class="pt-loading"><span class="pt-spinner" aria-hidden="true"></span>${esc(label)}</div>`;
  }

  showError(error) {
    this.innerHTML = `<div class="pt-panel pt-padded"><h3>Something went wrong</h3><p class="pt-error-text">${esc(error?.message || error)}</p></div>`;
  }
}

// ── Toasts ───────────────────────────────────────────────────────────────
const TOAST_DISMISS_MS = 6000;

export class PtToastStack extends PtElement {
  connect() {
    this.items = [];
    bus.subscribe('toast.show', (t) => this.add(t), this.abort.signal);
    this.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-toast-close]');
      if (btn) this.dismiss(btn.dataset.toastClose);
    }, { signal: this.abort.signal });
    this.render();
  }

  add(t) {
    const id = crypto.randomUUID();
    const tone = t.tone || 'info';
    this.items = [...this.items, { id, tone, message: t.message || '' }];
    this.render();
    if (tone !== 'error') setTimeout(() => this.dismiss(id), TOAST_DISMISS_MS);
  }

  dismiss(id) {
    const next = this.items.filter((i) => i.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.render();
  }

  render() {
    this.innerHTML = `<div class="pt-toast-stack">${this.items.map((i) => `
      <div class="pt-toast pt-toast-${esc(i.tone)}" role="${i.tone === 'error' ? 'alert' : 'status'}">
        <span>${esc(i.message)}</span>
        <button type="button" class="pt-toast-close" data-toast-close="${esc(i.id)}" aria-label="Dismiss notification">&times;</button>
      </div>`).join('')}</div>`;
  }
}
customElements.define('pt-toast-stack', PtToastStack);

// ── Focus-trapping dialog helper ────────────────────────────────────────
// Wraps a native <dialog> so every modal in the app traps focus, restores it
// on close, and closes on backdrop click — using the platform element
// instead of hand-rolling a modal div per the accessibility brief.
export function openDialog(dialogEl, { onClose } = {}) {
  const previouslyFocused = document.activeElement;
  dialogEl.addEventListener('click', (e) => { if (e.target === dialogEl) dialogEl.close('dismiss'); });
  const onCloseHandler = () => {
    previouslyFocused?.focus?.();
    onClose?.(dialogEl.returnValue);
    dialogEl.removeEventListener('close', onCloseHandler);
  };
  dialogEl.addEventListener('close', onCloseHandler);
  if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
  else dialogEl.setAttribute('open', '');
  const focusTarget = dialogEl.querySelector('[autofocus]') || dialogEl.querySelector('input, select, textarea, button');
  focusTarget?.focus();
}

/** Confirm a destructive action via a small native <dialog> instead of window.confirm(), so it fits the app's own styling and remains keyboard/focus-trapped. */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog pt-confirm-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="pt-dialog-actions">
          <button type="submit" value="cancel" class="pt-btn pt-btn-secondary">Cancel</button>
          <button type="submit" value="confirm" class="pt-btn ${danger ? 'pt-btn-danger' : 'pt-btn-primary'}" autofocus>${esc(confirmLabel)}</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    openDialog(dialog, { onClose: (value) => { dialog.remove(); resolve(value === 'confirm'); } });
  });
}

export function formatTime(date) {
  return new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
