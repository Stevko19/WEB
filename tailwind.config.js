/* Tailwind CSS 3.4 — konfigurácia šablóny Antropologické čítania.
   Farby odkazujú na CSS premenné v styles.css, takže tmavý/svetlý
   režim čítania sa mení len prepnutím premenných. */
const config = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        // galéria
        ink: 'var(--ink)',
        raised: 'var(--raised)',
        bone: 'var(--bone)',
        ash: 'var(--ash)',
        ochre: 'var(--ochre)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        // detail (režim čítania)
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        type: 'var(--type)',
        'type-2': 'var(--type-2)',
        accent: 'var(--accent)',
        rule: 'var(--rule)',
        done: 'var(--done)',
      },
      fontFamily: {
        read: ['Literata', '"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        ui: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
    },
  },
};

// Funguje pre CLI (module.exports) aj pre Play CDN v prehliadači (window.tailwind)
if (typeof module !== 'undefined') module.exports = config;
if (typeof window !== 'undefined' && window.tailwind) window.tailwind.config = config;
