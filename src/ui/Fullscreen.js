export function installFullscreen() {
  if (!document.fullscreenEnabled) return;
  const button = document.createElement('button');
  button.id = 'fullscreen-toggle';
  button.type = 'button';
  button.textContent = '⛶';
  const refresh = () => {
    const active = !!document.fullscreenElement;
    button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(active));
  };
  button.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { button.title = 'Fullscreen unavailable in this browser'; }
  });
  document.addEventListener('fullscreenchange', refresh);
  refresh();
  document.body.appendChild(button);
}
