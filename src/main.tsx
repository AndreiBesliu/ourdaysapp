
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { onDeletedInAnotherTab } from './utils/accountDeletion'

// Another tab of the app deleted the account: this one reloads, onto the sign-in screen, before its
// Firestore (whose cache that tab clears) is left shut down under it (utils/accountDeletion.ts).
onDeletedInAnotherTab(window, () => window.location.replace('/login'))

createRoot(document.getElementById('root')!).render(
    <App />
)
