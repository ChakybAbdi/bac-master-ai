// Runs before the app loads so the page never flashes the wrong theme or text direction.
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem('bm.theme');
    var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    var locale = localStorage.getItem('bm.locale');
    if (locale !== 'fr' && locale !== 'ar') locale = (navigator.language || '').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'fr';
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
  } catch (e) {
    // Storage can be unavailable (private mode): the defaults in index.html apply.
  }
})();
