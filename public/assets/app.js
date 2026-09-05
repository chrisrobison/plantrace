// Application entry point. Every custom element self-registers on import
// (see each components/*.js file), so booting the app is just importing the
// shell — <pt-app-shell> takes it from there (see pt-app-shell.js).
import './core.js';
import './components/pt-app-shell.js';

window.addEventListener('error', (e) => {
  console.error('[PlanTrace]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[PlanTrace] unhandled rejection', e.reason);
});
