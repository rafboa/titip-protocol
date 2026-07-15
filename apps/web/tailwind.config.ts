import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1200px' },
    },
    extend: {
      // Extra-small breakpoint for very narrow phones (below the 375px design target)
      screens: {
        xs: '400px',
      },
      colors: {
        border: 'var(--border-glass)',
        input: 'var(--border-glass)',
        ring: 'var(--primary)',
        background: 'var(--bg-main)',
        foreground: 'var(--text-main)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          glow: 'var(--primary-glow)',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: '#0B0E14',
        },
        destructive: {
          DEFAULT: 'var(--danger)',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: 'var(--bg-secondary)',
          foreground: 'var(--text-muted)',
        },
        popover: {
          DEFAULT: 'var(--bg-secondary)',
          foreground: 'var(--text-main)',
        },
        card: {
          DEFAULT: 'var(--bg-glass)',
          foreground: 'var(--text-main)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [],
}

export default config
