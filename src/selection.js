// Read the real selection from the source page at trigger time (spec §7.6). The
// injected function is self-contained because Chrome serializes it into the page.

export function readSelectionInPage() {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && typeof element.selectionStart === 'number')) {
    const value = element.value.slice(element.selectionStart, element.selectionEnd);
    if (value) return value;
  }
  return String(window.getSelection ? window.getSelection() : '');
}

export function createSelectionReader(api) {
  async function collect(target) {
    const results = await api.scripting.executeScript({ target, func: readSelectionInPage });
    const texts = results.map(item => (typeof item?.result === 'string' ? item.result : ''));
    const main = results.findIndex(item => item.frameId === 0);
    if (main !== -1 && texts[main].trim()) return texts[main];
    return texts.find(text => text.trim()) ?? '';
  }

  /**
   * @param {{ tabId: number, frameId?: number, fallbackText?: string }} options
   * @returns {Promise<{ text: string, source: 'page' | 'context-menu' | 'none' | 'blocked' }>}
   */
  return async function readSelection({ tabId, frameId, fallbackText }) {
    const attempts = frameId !== undefined && frameId !== null
      ? [{ tabId, frameIds: [frameId] }, { tabId }]
      : [{ tabId, allFrames: true }, { tabId }];
    let blocked = true;
    for (const target of attempts) {
      try {
        const text = await collect(target);
        blocked = false;
        if (text.trim()) return { text, source: 'page' };
      } catch {
        // Restricted page, missing permission or an inaccessible frame: try the next scope.
      }
    }
    if (typeof fallbackText === 'string' && fallbackText.trim()) return { text: fallbackText, source: 'context-menu' };
    return { text: '', source: blocked ? 'blocked' : 'none' };
  };
}
