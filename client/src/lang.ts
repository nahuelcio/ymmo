// The player's language. Stored per browser; first visit follows the browser language.
// Changing it reloads the page so every text is rebuilt in the new language.
import { isLang, tr, type Lang } from '../../shared/src/i18n';

function detect(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return /^es\b/i.test(navigator.language) ? 'es' : 'en';
}

export const lang: Lang = detect();

/** Bilingual UI string: t('castellano', 'english'). */
export const t = (es: string, en: string) => tr(lang, es, en);

export function setLang(l: Lang) {
  if (l === lang) return;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
  location.reload();
}

/** Number formatting for the current language. */
export const fmt = (n: number) => n.toLocaleString(lang === 'es' ? 'es-AR' : 'en-US');
