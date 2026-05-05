# Our Days App - Development Log

## 🏗 Project Infrastructure (Permanent)
*   **GitHub Repository**: [AndreiBesliu/ourdaysapp](https://github.com/AndreiBesliu/ourdaysapp.git)
*   **Firebase Project ID**: `our-days-2a939`
*   **Firebase Hosting URL**: [https://our-days-2a939.web.app](https://our-days-2a939.web.app)
*   **Firebase Console**: [Console Overview](https://console.firebase.google.com/project/our-days-2a939/overview)
*   **Connection Status**: 
    *   Git: Connected & Pushing to `main`.
    *   Firebase: Authenticated via CLI; Deployment via `npx firebase-tools deploy`.

---

## 📜 Workflow Rules (Permanent)
To maintain consistency and clarity across all development sessions, the following rules **must** be followed:
1.  **Start-of-Task Logging**: Every new task or feature implementation must begin with a log entry stating exactly what the model is starting to do.
2.  **End-of-Task Logging**: Every completed task must conclude with a log entry summarizing what has been done, what was tested, and any deployment status.
3.  **Roadmap Sync**: The roadmap below must be updated immediately upon completion of a feature.
4.  **Manual Deployment**: Deployment to Firebase Hosting must be done at the end of every successful feature implementation after a successful `npm run build`.

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
- **Group Chat**: Real-time collapsible chat popup for group members.
- **In-App Notifications**: Notification bell with alerts for task assignments and group activity.
- **Transferable Assets**: Hand over ownership of wallet assets with an optional "Keep Copy" feature.
- **Autosave Engine**: Prevents data loss by saving event drafts to `localStorage`.
- **Task Assignment Constraints**: Logic to filter assignees based on active group/calendar type.
- **Barcode Rendering**: inline barcode/QR display for checklist items in `EventDetailsModal`.

---

## 📅 Session Log: May 5, 2026

**18:10 - Task Started**: Starting implementation of Task Assignment Constraints and Autosave Engine.
**18:15 - Task Completed**: Constraints enforced in `AddEventModal` and `EventDetailsModal`. Autosave logic added to `AddEventModal`. Verified via build.

**18:20 - Task Started**: Starting implementation of Transferable Assets in `Wallet.tsx`.
**18:30 - Task Completed**: Transfer logic with "Keep Copy" checkbox added. UI updated in Wallet Edit modal. Deployed to Firebase.

**18:22 - Task Started**: Starting implementation of Group Chat Widget and In-App Notifications.
**18:27 - Task Completed**: Created `GroupChatWidget` and `NotificationsDropdown`. Integrated into `CalendarHome`. Fixed TS errors and verified build. Deployed to Firebase.
