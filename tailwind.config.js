/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sidebar': '#1e1e1e',
        'sidebar-hover': '#2a2a2a',
        'panel': '#252526',
        'editor-bg': '#1e1e1e',
        'accent': '#007acc',
      }
    },
  },
  plugins: [],
}
