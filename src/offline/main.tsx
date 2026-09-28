// src/offline/main.tsx — entry of the offline Cards page (built by vite.offline.config.ts).
import { createRoot } from 'react-dom/client';
import './offline.css';
import OfflineCards from './OfflineCards';
import { rememberedLanguage } from '../utils/languagePref';
import { t } from '../utils/i18n';

// The page speaks the person's language, so it says so: a screen reader otherwise reads Romanian or
// German with the English voice (review, 28.09.2026).
const language = rememberedLanguage();
document.documentElement.lang = language.split('-')[0] || 'en';
document.title = `Our Days — ${t('offlineCardsTitle', language)}`;

createRoot(document.getElementById('root')!).render(<OfflineCards />);
