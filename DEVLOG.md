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

1.  **Start-of-Task Logging** — Before writing any code, append a `Task Started` entry to the **Session Log section of this file** (not just in chat). The entry must include:
    - Date & time (local)
    - The exact user prompt that triggered the task
    - A one-line summary of what the model intends to do
    - Format:
      ```
      **YYYY-MM-DD HH:MM - Task Started**
      > Prompt: "<exact user prompt>"
      > Plan: <one-line description of what will be done>
      ```
2.  **End-of-Task Logging** — After deploying, append a `Task Completed` entry to this file summarising what changed, what was tested, and the deploy status.
3.  **Roadmap Sync** — Move completed features from "Roadmap" to "Completed Features" in this file.
4.  **Build Before Deploy** — Always run `npm run build` successfully before deploying.
5.  **Deploy After Every Feature** — Run `npx firebase-tools deploy --only hosting` and commit + push to Git after each feature is done.

---

## 🚀 Active Roadmap & Backlog

### 1. In Progress / Upcoming
- **Minigames**: Integrate a simple embedded game (e.g., HTML5 Canvas or React) to make the app more engaging for the family.
- **AI Integration**:
  - Connect to an AI service (e.g., Gemini / OpenAI) to auto-suggest tasks or categorize events.
  - Create a special "AI Group" where you can add tasks, and the AI will process or auto-complete them.
- **True Push Notifications**: Implement Firebase Cloud Functions to send OS-level push notifications (Requires Firebase Blaze Plan).

### 2. Backlog
- **Android Compilation**: Wrap the web/PWA into a native Android APK build once the web version is feature-complete.
- **UI Refinement**: Continue polishing dark mode transitions and mobile responsiveness.

---

## ✅ Completed Features
- **Group Chat**: Real-time collapsible chat popup for group members, with image sharing and seen status.
- **Group Settings Modal**: Replaced "Delete Group" with an "Edit Group" modal covering rename, member management, and delete/leave.
- **In-App Notifications**: Notification bell with alerts for task assignments and group activity.
- **Transferable Assets**: Hand over ownership of wallet assets with an optional "Keep Copy" feature.
- **Autosave Engine**: Prevents data loss by saving event drafts to `localStorage`.
- **Task Assignment Constraints**: Logic to filter assignees based on active group/calendar type.
- **Barcode Rendering**: Inline barcode/QR display for checklist items in `EventDetailsModal`.
- **Auto-contrast Text**: WCAG-compliant luminance calculation automatically picks dark/light text on primary color backgrounds.
- **Dark Mode Default**: New users start in dark mode by default.
- **Profile Photo Fix**: Current user's Firestore photoURL now appears everywhere (member circles, chat, event modals).

---

## 📅 Session Log: May 5, 2026

**~18:10 - Task Started**: Implementing Task Assignment Constraints and Autosave Engine.
**~18:15 - Task Completed**: Constraints enforced in `AddEventModal` and `EventDetailsModal`. Autosave draft logic added to `AddEventModal`. Build verified. Deployed.

**~18:20 - Task Started**: Implementing Transferable Assets in `Wallet.tsx`.
**~18:30 - Task Completed**: Transfer logic with "Keep Copy" checkbox added. Deployed.

**~18:22 - Task Started**: Implementing Group Chat Widget and In-App Notifications.
**~18:27 - Task Completed**: Created `GroupChatWidget.tsx` and `NotificationsDropdown.tsx`. Integrated into `CalendarHome`. TS errors fixed, build verified. Deployed.

**~18:31 - Task Started**: Amending DEVLOG with infrastructure, workflow rules, and session logging.
**~18:31 - Task Completed**: DEVLOG restructured with permanent sections. Pushed to GitHub.

**~18:52 - Task Started**: Auto-contrast text color on primary backgrounds.
**~19:01 - Task Completed**: WCAG luminance calculation added to `App.tsx`. CSS rule added to `index.css`. Fixed threshold bug (Amber at 50% L was incorrectly getting white text). Deployed.

**~19:07 - Task Started**: Chat enhancements — image sending and sent/seen status.
**~19:14 - Task Completed**: `GroupChatWidget` rewritten with image upload (Firebase Storage), `seenBy` array, and sent/seen indicators. Dark mode default for new users added. Deployed.

**~19:14 - Task Started**: Chat header member avatars + retroactive seen marking.
**~19:14 - Task Completed**: Member avatars added to chat header. When a user sends a message, prior unseen messages are retroactively marked. Deployed.

**~19:15 - Task Started**: Replace "Delete Group" with "Edit Group" settings modal.
**~19:17 - Task Completed**: `GroupSettingsModal.tsx` created with rename, member management, and danger zone (delete/leave with confirmation). Deployed.

**~19:19 - Task Started**: Fix profile photo not showing in all avatar locations.
**~19:20 - Task Completed**: `userMap` now fetches current user's Firestore doc (was skipped before). Removed stale `auth.currentUser.photoURL` fallbacks in modals. Deployed.

**~19:26 - Task Started**: Fix chat "Seen" status not updating reliably.
**~19:27 - Task Completed**: Switched from purely `seenBy`-array-based detection to reply-ordering inference — if someone replied after your message, it's marked Seen. `seenBy` array kept as fallback. Deployed.

**~19:27 - Task Started**: Update DEVLOG with all session tasks and strengthen workflow rules.
**~19:27 - Task Completed**: Full session log written. Workflow rules clarified to require file edits (not just chat mentions).

---

## 📅 Session Log: May 5, 2026 (continued)

**2026-05-05 22:27 - Task Started**
> Prompt: "it seems that the devlog is not being updated as it says in the rules, are the rules not well established or written?"
> Plan: Catch up all missed task log entries and tighten workflow rule wording to require file edits explicitly.

**2026-05-05 22:27 - Task Completed**: DEVLOG fully caught up with all session tasks. Rule 1 reworded. Pushed to GitHub.

---

**2026-05-05 22:29 - Task Started**
> Prompt: "logging the start of the task should also log the prompt entered and the date"
> Plan: Update workflow Rule 1 to require exact prompt text and date/time in every Task Started log entry.

**2026-05-05 22:29 - Task Completed**: Rule 1 updated with required format including date, prompt, and plan. This entry is the first example of the new format. Pushed to GitHub.
