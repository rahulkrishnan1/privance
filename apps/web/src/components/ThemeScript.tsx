/**
 * Runs before React hydrates to set class="dark" on <html> when the OS
 * prefers dark mode. This prevents flash-of-unstyled-content (FOUC).
 *
 * This is a Server Component intentionally, it emits a blocking inline
 * script with no client JS overhead.
 */

const THEME_SCRIPT = `try{if(window.matchMedia('(prefers-color-scheme:dark)').matches){document.documentElement.classList.add('dark');}}catch(e){}`;

export function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional inline script for dark-mode FOUC prevention; content is a static string literal with no user input
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
