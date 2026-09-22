/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          black: '#080c10',
          dark: '#0c1219',
          surface: '#121a24',
          border: '#1f2937',
          muted: '#8b949e',
          green: '#00ff66',
          'green-dim': '#00bb4b',
          amber: '#ffb000',
          'amber-dim': '#cc8c00',
          red: '#ff3344',
          'red-dim': '#cc2936',
          cyan: '#00e5ff',
          blue: '#3b82f6',
          violet: '#a78bfa'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'Menlo', 'monospace']
      },
      animation: {
        'radar-sweep': 'sweep 3s linear infinite',
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        ripple: 'ripple 1.8s cubic-bezier(0, 0.2, 0.8, 1) infinite'
      },
      keyframes: {
        sweep: { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        ripple: { '0%': { transform: 'scale(0.6)', opacity: '0.9' }, '100%': { transform: 'scale(2.6)', opacity: '0' } }
      }
    }
  },
  plugins: []
};
