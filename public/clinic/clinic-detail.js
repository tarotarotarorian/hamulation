(() => {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-affiliate-cta]');
    if (!link) return;

    const payload = {
      clinic: link.dataset.clinic || 'unknown',
      page: 'clinic_detail',
      placement: link.dataset.placement || 'unknown'
    };

    if (typeof window.gtag === 'function') window.gtag('event', 'affiliate_click', payload);
    if (typeof window.clarity === 'function') window.clarity('event', 'affiliate_click');
  });
})();
