// Offscreen document used only to write text to the clipboard from the service worker.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'offscreen-copy' || sender.id !== chrome.runtime.id) return false;
  const field = /** @type {HTMLTextAreaElement} */ (document.getElementById('text'));
  field.value = message.text ?? '';
  field.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  respond({ ok });
  return false;
});
