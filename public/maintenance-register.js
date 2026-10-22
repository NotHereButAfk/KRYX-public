if ('serviceWorker' in navigator && location.protocol === 'https:'
    && ['kryx.live','www.kryx.live'].includes(location.hostname)) {
  navigator.serviceWorker.register('/maintenance-worker.js',{scope:'/',updateViaCache:'none'})
    .catch(() => {}); // An unavailable fallback must never prevent the game loading.
}
