// Reserve layout space, but never run a provider iframe underneath another screen.
import { isCrazyGames } from '../core/CrazyGamesAccount.js';
export function installInlineAds() {
  if (isCrazyGames()) {
    document.getElementById('frame')?.remove();
    document.body.classList.remove('has-top-ad');
    return;
  }
  let frame = document.getElementById('frame');
  if (!frame) {
    frame = document.createElement('aside');
    frame.id = 'frame'; frame.className = 'aads-inline';
    frame.setAttribute('aria-label', 'Advertisement');
    const banner = document.createElement('div');
    banner.className = 'aads-banner';
    banner.dataset.unit = '2458071';
    banner.dataset.src = 'https://acceptable.a-ads.com/2458071/?size=Adaptive';
    frame.appendChild(banner); document.body.appendChild(frame);
  }
  if (!document.querySelector('script[data-kryx-adsense]')) {
    const script = document.createElement('script');
    script.async = true; script.crossOrigin = 'anonymous';
    script.dataset.kryxAdsense = 'true';
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2402830875754567';
    document.head.appendChild(script);
  }
  const slot = frame?.querySelector('.aads-banner');
  if (!slot) return;
  const pages = [...document.querySelectorAll('.nav-panel')];
  const home = document.getElementById('center-play');
  const nav = document.getElementById('top-nav');
  const loading = document.getElementById('map-loading');
  const startup = document.getElementById('connect-screen');
  const intermission = document.getElementById('post-match-ads');
  const visible = node => node && !node.classList.contains('hidden');
  let provider = slot.querySelector('iframe');
  let timer = null;
  const unload = () => { provider?.remove(); provider = null; };
  const clearSpace = () => {
    for (let node = slot; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < .99) return false;
    }
    const rect = slot.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 40 || rect.top < 0 || rect.left < 0
      || rect.bottom > innerHeight + .5 || rect.right > innerWidth + .5) return false;
    // Hit-test edges and centre to catch clipped panels, checkout dialogs and menus.
    for (const x of [rect.left + 1, rect.left + rect.width / 2, rect.right - 1]) {
      for (const y of [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1]) {
        const top = document.elementFromPoint(x, y);
        if (!top || (top !== slot && !slot.contains(top))) return false;
      }
    }
    return true;
  };
  const update = () => {
    // Keep an in-flight ad alive when the tab is backgrounded.
    if (document.hidden) { clearTimeout(timer); timer = null; return; }
    const target = true; // The reference keeps its bottom banner through gameplay too.
    document.body.classList.toggle('ad-over-loading', !!(visible(startup) || visible(loading)));
    document.body.classList.toggle('has-top-ad', !!target);
    frame.classList.toggle('hidden', !target);
    if (!target || !clearSpace()) unload();
    else if (!provider) {
      provider = document.createElement('iframe');
      provider.title = 'Advertisement';
      provider.loading = 'eager';
      provider.dataset.aa = slot.dataset.unit;
      provider.src = slot.dataset.src;
      slot.appendChild(provider);
    }
    clearTimeout(timer);
    // Check overlays and layout changes only while an ad placement is active.
    timer = target ? setTimeout(update, 1000) : null;
  };
  const observer = new MutationObserver(update);
  for (const node of [...pages, loading, startup, intermission, home, nav].filter(Boolean)) {
    observer.observe(node, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', update);
  document.addEventListener('scroll', update, true);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    observer.disconnect(); clearTimeout(timer); unload();
    window.removeEventListener('resize', update);
    document.removeEventListener('scroll', update, true);
    document.removeEventListener('visibilitychange', update);
  };
}
