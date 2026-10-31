/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Token names kept from v2 so every component restyles from one place.
        terminal: {
          black: '#0b1017',     // app background
          dark: '#111821',      // card
          surface: '#162030',   // card header / inputs
          border: '#243142',
          muted: '#8b97a8',
          green: '#22c55e',
          'green-dim': '#16a34a',
          amber: '#f59e0b',
          'amber-dim': '#d97706',
          red: '#ef4444',
          'red-dim': '#dc2626',
          cyan: '#38bdf8',
          blue: '#3b82f6',
          violet: '#a78bfa'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.12)',
        pop: '0 10px 30px -10px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3)'
      },
      animation: {
        'radar-sweep': 'sweep 3s linear infinite',
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        ripple: 'ripple 1.8s cubic-bezier(0, 0.2, 0.8, 1) infinite',
        'sheet-up': 'sheetUp 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out'
      },
      keyframes: {
        sweep: { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        ripple: { '0%': { transform: 'scale(0.6)', opacity: '0.9' }, '100%': { transform: 'scale(2.6)', opacity: '0' } },
        sheetUp: { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } }
      }
    }
  },
  plugins: []
};
