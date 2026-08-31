/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    colors: {
      accent: {
        DEFAULT: 'hsl(var(--accent))',
        foreground: 'hsl(var(--accent-foreground))',
      },
      background: 'hsl(var(--background))',
      border: 'hsl(var(--border))',
      'border-darker': 'hsl(var(--border-darker))',
      brand: 'hsl(var(--brand))',
      card: {
        DEFAULT: 'hsl(var(--card))',
        foreground: 'hsl(var(--card-foreground))',
      },
      danger: {
        DEFAULT: 'hsl(var(--danger))',
        foreground: 'hsl(var(--danger-foreground))',
      },
      foreground: 'hsl(var(--foreground))',
      input: 'hsl(var(--input))',
      muted: {
        DEFAULT: 'hsl(var(--muted))',
        foreground: 'hsl(var(--muted-foreground))',
      },
      popover: {
        DEFAULT: 'hsl(var(--popover))',
        foreground: 'hsl(var(--popover-foreground))',
      },
      primary: {
        DEFAULT: 'hsl(var(--primary))',
        foreground: 'hsl(var(--primary-foreground))',
      },
      ring: 'hsl(var(--ring))',
      'sidebar-section-background': 'hsl(var(--sidebar-section-background))',
      success: {
        DEFAULT: 'hsl(var(--success))',
        foreground: 'hsl(var(--success-foreground))',
      },
      tooltip: {
        DEFAULT: 'hsl(var(--tooltip))',
        foreground: 'hsl(var(--tooltip-foreground))',
      },
      transparent: 'transparent',
      warning: {
        DEFAULT: 'hsl(var(--warning))',
        foreground: 'hsl(var(--warning-foreground))',
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.75rem', '0.875rem'],
        xs: ['0.8125rem', '1rem'],
      },
      spacing: {
        'content-width': '96rem',
      },
    },
  },
  plugins: [],
}
