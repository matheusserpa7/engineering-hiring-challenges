// jsdom's HTMLDialogElement is empty: it has no showModal() or close(). This shim only toggles the
// `open` attribute so components that call them can mount. It is an environment gap, not a mock of
// the code under test; the real modal behaviour (inert page, Escape, focus) is proven in Chromium
// by e2e/refund.spec.ts.
if (
  typeof HTMLDialogElement !== 'undefined' &&
  typeof HTMLDialogElement.prototype.showModal !== 'function'
) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open');
  };
}
