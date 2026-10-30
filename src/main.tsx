import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { onDeletedInAnotherTab } from './utils/accountDeletion'
import { bootLanguageReady } from './store'

// Another tab of the app deleted the account: this one reloads, onto the sign-in screen, before its
// Firestore (whose cache that tab clears) is left shut down under it (utils/accountDeletion.ts).
onDeletedInAnotherTab(window, () => window.location.replace('/login'))

// The first paint is in the person's language. English and Romanian are already here, so for them this
// starts at once; French, Spanish, Italian and German come in a chunk of their own (30.10.2026), and
// the first paint waits for it — but not for long: past 1.5 s the app opens in English and switches when
// the language arrives (store.ts). A function, not a top-level await: the entry finishes first.
const start = () => createRoot(document.getElementById('root')!).render(
    <App />
)
void Promise.race([bootLanguageReady, new Promise<void>((resolve) => setTimeout(resolve, 1500))]).then(start)
