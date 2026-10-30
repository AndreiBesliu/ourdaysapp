// src/utils/i18nAll.ts
//
// Every language at once, registered as soon as this module is imported (30.10.2026). The app loads
// four of the six on demand (i18n.ts, `loadLanguage`); two things must not wait for a chunk:
//   * the offline Cards page, a separate build that has to open with nothing fetched, in the person's
//     language whichever it is (src/offline/main.tsx imports this first);
//   * the tests, which hold every language to the same keys.
// The app itself never imports this: it would pull the four back into what loads at boot
// (scripts/check-split.mjs refuses that build).

import { registerLanguage } from './i18n';
import fr, { dateLocale as frDates } from './lang/fr-FR';
import es, { dateLocale as esDates } from './lang/es-ES';
import it, { dateLocale as itDates } from './lang/it-IT';
import de, { dateLocale as deDates } from './lang/de-DE';

registerLanguage('fr-FR', { default: fr, dateLocale: frDates });
registerLanguage('es-ES', { default: es, dateLocale: esDates });
registerLanguage('it-IT', { default: it, dateLocale: itDates });
registerLanguage('de-DE', { default: de, dateLocale: deDates });

export { translations, locales, t, getDateLocale } from './i18n';
