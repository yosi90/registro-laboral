/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{html,js,ts,jsx,tsx,md,mdx}'],
  safelist: [
    // Asegurar que las clases de spacing estén disponibles si Tailwind no las detecta
    {
      pattern: /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml)-\d+$/,
    },
  ],
  // Agregar una safelist explícita de utilidades de spacing comunes como fallback
  // (esto fuerza a Tailwind a incluir estas clases en la salida)
  // Nota: quitar esto cuando el problema de detección esté resuelto para evitar CSS innecesario.
  safelist: [
    'p-0','p-1','p-2','p-3','p-4','p-5','p-6','px-2','px-4','px-6','py-2','py-4','py-6',
    'm-0','m-1','m-2','m-3','m-4','m-5','m-6','mx-auto'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
