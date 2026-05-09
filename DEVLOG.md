# Our Days App - Development Log

## 🏗 Project Infrastructure (Permanent)
*   **GitHub Repository**: [AndreiBesliu/ourdaysapp](https://github.com/AndreiBesliu/ourdaysapp.git)
*   **Firebase Project ID**: `our-days-2a939`
*   **Firebase Hosting URL**: [https://our-days-2a939.web.app](https://our-days-2a939.web.app)
*   **Firebase Console**: [Console Overview](https://console.firebase.google.com/project/our-days-2a939/overview)
*   **Connection Status**:
    *   Git: Connected & Pushing to `main`.
    *   Firebase: Authenticated via CLI; Deployment via `npx firebase-tools deploy --only hosting`.

---

## 📜 Workflow Rules (Permanent)
> ⚠️ These rules apply to EVERY session and EVERY task, no exceptions.

1.  **Start-of-Task Logging** — Before writing any code, append a `Task Started` entry to the **Session Log section of this file**.
    - Format:
      ```
      **YYYY-MM-DD HH:MM - Task Started**

      > Prompt: "<exact user prompt>"
      > Plan: <one-line description of what will be done>
      ```
2.  **End-of-Task Logging** — After deploying, append a `Task Completed` entry summarising what changed.
3.  **Roadmap Sync** — Move completed features from "Roadmap" to "Completed Features".
4.  **Build Before Deploy** — Always run `npm run build` successfully before deploying.
5.  **Deploy After Every Feature** — Deploy to hosting and push to Git after each feature.
6.  **Secret Management** — NEVER hardcode API keys. Use `.env` or Firebase Secrets.

---

## 🚀 Active Roadmap & Backlog

### 1. In Progress / Upcoming
- **Rummy 45 (Phase 4)**: Finalize game-ending logic, point calculation, and UI polish for the "Tabla" grid.
- **Chat Reactions**: Add emoji reactions to chat messages.
- **Typing Indicators**: Show when someone is typing in the group chat.
- **Android Compilation**: Wrap the app into a native APK using Capacitor.

> **UI/UX Design Constraints (Explicit User Preferences)**
> 🚫 NO Swipe Actions.
> 🚫 NO Confetti/heavy animations.
> ⚠️ Haptics should be used subtly.
> ✅ YES to clean, power-user premium UX.

### 2. Backlog
- **UI Refinement**: Continue polishing dark mode transitions and mobile responsiveness.
- **Uno/Other Games**: Expand the Arcade with more simple multiplayer games.

---

## ✅ Completed Features
- **Internationalization (i18n)**: Full app support for English, Romanian, French, Spanish, Italian, and German.
- **Natural Language Parsing**: Automatic date/time extraction from titles using `chrono-node`.
- **Rapid List Entry**: Keyboard-optimized checklist entry with auto-focus and Enter-key support.
- **Smart Asset Auto-Linking**: Contextual loyalty card suggestions based on event/checklist text.
- **Collapsible Week View**: Month/Week view toggle in the Calendar.
- **Pull-to-Refresh**: Native-feeling refresh mechanism on the home screen.
- **Multiplayer Arcade**: Tic-Tac-Toe, Connect 4, and Rummy 45 (Phases 1-3) implemented with real-time sync.
- **True Push Notifications**: FCM integration for chat and game invites.
- **AI Assistant**: Checklist generation via Gemini 2.5 Flash Lite.
- **Group Chat**: Real-time chat with image sharing and seen status.
- **Transferable Assets**: Hand over ownership of wallet assets with "Keep Copy".
- **Autosave Engine**: Draft persistence in localStorage and real-time Firestore sync.
- **Barcode Rendering**: Inline barcode/QR display in modals.
- **Auto-contrast Text**: WCAG-compliant text color selection.
- **Dark Mode Default**: Default theme for new users.
- **Profile Photo Fix**: Global Firestore-synced profile photos.

---

## ?? Session Log: May 9, 2026

**2026-05-09 08:40 - Task Started**
> Prompt: "make sure the rules are in the language selected by the user"
> Plan: Implement localization for the Games Hub manual system.

**2026-05-09 08:46 - Task Completed**
Localize game rules based on user language. Deployed.

**2026-05-09 08:47 - Task Started**
> Prompt: "ok, the language setting seems to reset when i reset the app"
> Plan: Fix settings hydration in App.tsx.

**2026-05-09 08:48 - Task Completed**
Hydrated language setting from Firestore on startup. Deployed.

**2026-05-09 08:52 - Task Started**
> Prompt: "i want more things to take language into account, the calendar, the UI elements throughout"
> Plan: Implement full app i18n using a central utility.

**2026-05-09 08:57 - Task Completed**
Full app internationalization implemented for Calendar, Wallet, Settings, and Dashboard. Deployed.
