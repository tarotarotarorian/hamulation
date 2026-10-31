(() => {
  const informationDates = {
    '/clinic/haku-whitening.html': '2026年09月22日',
    '/clinic/lulu-white.html': '2026年09月22日',
    '/clinic/pearl-whitening.html': '2026年09月22日',
    '/clinic/star-whitening.html': '2026年10月31日',
    '/clinic/whitening-cafe.html': '2026年09月22日',
    '/clinic/yc-whitening.html': '2026年10月31日'
  };

  const informationSources = {
    '/clinic/star-whitening.html': '<a href="https://www.starwhitening.jp/" target="_blank" rel="noopener">公式料金・返金保証</a> ／ <a href="https://starwhitening.net/" target="_blank" rel="noopener">公式予約</a>',
    '/clinic/yc-whitening.html': '<a href="https://ycwhitening.jp/" target="_blank" rel="noopener">公式料金・対象院</a> ／ <a href="https://ycwhitening.jp/abbelire-club/" target="_blank" rel="noopener">定額制の公式案内</a>'
  };

  const policyLink = (placement) => {
    const link = document.createElement('a');
    link.href = '/editorial-policy.html';
    link.dataset.editorialPolicyLink = placement;
    link.textContent = '掲載・比較ポリシー';
    return link;
  };

  const heroTitle = document.querySelector('.hero__copy h1');
  if (heroTitle) {
    const disclosure = document.createElement('div');
    disclosure.className = 'ad-disclosure';
    disclosure.append('広告（アフィリエイト広告を含みます）', policyLink('clinic_hero_disclosure'));
    heroTitle.insertAdjacentElement('afterend', disclosure);
  }

  const informationDate = informationDates[window.location.pathname] || '2026年09月22日';
  const informationSource = informationSources[window.location.pathname] || '公式サイト';
  const priceSection = [...document.querySelectorAll('.section')].find((section) => {
    const eyebrow = section.querySelector('.eyebrow');
    return eyebrow && /PRICE GUIDE/.test(eyebrow.textContent);
  });
  if (priceSection) {
    const source = document.createElement('p');
    source.className = 'information-source';
    source.innerHTML = `<span><strong>情報確認日：</strong>${informationDate}</span><span><strong>参照元：</strong>${informationSource}</span>`;
    const intro = priceSection.querySelector('.section-intro');
    (intro || priceSection.querySelector('h2'))?.insertAdjacentElement('afterend', source);
  } else {
    const source = document.createElement('p');
    source.className = 'information-source';
    source.innerHTML = `<span><strong>情報確認日：</strong>${informationDate}</span><span><strong>参照元：</strong>${informationSource}</span>`;
    document.querySelector('.disclaimer')?.insertAdjacentElement('beforebegin', source);
  }

  const footerBack = document.querySelector('.footer-back');
  if (footerBack) {
    const footerLinks = document.createElement('nav');
    footerLinks.className = 'clinic-footer-links';
    footerLinks.setAttribute('aria-label', 'サイト情報');
    footerLinks.append(
      policyLink('clinic_footer'),
      Object.assign(document.createElement('a'), { href: '/about.html', textContent: '運営者情報' }),
      Object.assign(document.createElement('a'), { href: '/privacy.html', textContent: 'プライバシーポリシー' }),
      Object.assign(document.createElement('a'), { href: '/terms.html', textContent: '免責事項' })
    );
    footerBack.insertAdjacentElement('beforebegin', footerLinks);
  }

  document.addEventListener('click', (event) => {
    const policy = event.target.closest('[data-editorial-policy-link]');
    if (policy) {
      const payload = { source_page: 'clinic_detail', placement: policy.dataset.editorialPolicyLink || 'unknown' };
      if (typeof window.gtag === 'function') window.gtag('event', 'editorial_policy_click', payload);
      if (typeof window.clarity === 'function') window.clarity('event', 'editorial_policy_click');
      return;
    }

    const link = event.target.closest('[data-affiliate-cta]');
    if (!link) return;

    const payload = {
      clinic: link.dataset.clinic || 'unknown',
      offer_id: link.dataset.offerId || 'unknown',
      source_page: 'clinic_detail',
      placement: link.dataset.placement || 'unknown'
    };

    if (typeof window.gtag === 'function') window.gtag('event', 'affiliate_click', payload);
    if (typeof window.clarity === 'function') window.clarity('event', 'affiliate_click');
  });
})();
