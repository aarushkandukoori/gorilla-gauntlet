/* ads.js — ad slot loader.
 * Fill in ADS_CONFIG once you have an ad network account. With `enabled: false`
 * (or no client id) every slot renders as a labelled placeholder so the layout
 * is stable before ads are live.
 *
 * Google AdSense: set provider 'adsense', client 'ca-pub-XXXXXXXXXXXXXXXX', and
 * one slot id per placement (create Display ad units in the AdSense console).
 * Also host an ads.txt at the site root — see README.
 */
window.ADS_CONFIG = {
  enabled: false,                   // flip to true once `client` is filled in
  provider: 'adsense',
  client: '',                       // your AdSense publisher id, e.g. 'ca-pub-1234567890123456'
  // Optional: Display ad unit slot ids. Leave empty to use AdSense Auto ads (client id only).
  slots: { leaderboard: '', sidebar: '', footer: '' },
};

(function () {
  const cfg = window.ADS_CONFIG;
  const live = cfg.enabled && /^ca-pub-\d{10,}$/.test(cfg.client || '') && cfg.provider === 'adsense';
  const els = document.querySelectorAll('.ad[data-ad]');
  if (!els.length) return;
  if (!live) {
    els.forEach(el => { el.classList.add('placeholder'); el.textContent = 'Advertisement · ' + (el.dataset.size || ''); });
    return;
  }
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client);
  document.head.appendChild(s);
  const anySlot = Object.values(cfg.slots || {}).some(Boolean);
  if (!anySlot) {
    // Auto ads: Google chooses placements; hide the reserved boxes so nothing sits empty.
    els.forEach(el => { el.hidden = true; });
    return;
  }
  els.forEach(el => {
    const slot = cfg.slots[el.dataset.ad];
    if (!slot) { el.hidden = true; return; }
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = cfg.client;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    el.textContent = '';
    el.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
})();
