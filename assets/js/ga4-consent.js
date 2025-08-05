
(function () {
  function gtag() { window.dataLayer.push(arguments); }
  function loadGA4() {
    if (!window.ga4_measurement_id) return;
    let script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${window.ga4_measurement_id}`;
    script.async = true;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    gtag('js', new Date());
    gtag('config', window.ga4_measurement_id);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('cookie-consent-banner');
    const accepted = localStorage.getItem('cookie_consent');

    if (accepted === 'true') {
      loadGA4();
    } else if (accepted !== 'false') {
      banner.classList.remove('hidden');
    }

    document.getElementById('accept-cookies')?.addEventListener('click', () => {
      localStorage.setItem('cookie_consent', 'true');
      banner.classList.add('hidden');
      loadGA4();
    });

    document.getElementById('decline-cookies')?.addEventListener('click', () => {
      localStorage.setItem('cookie_consent', 'false');
      banner.classList.add('hidden');
    });
  });
})();
