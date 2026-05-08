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
6.  **Secret Management** — NEVER hardcode API keys or secrets in source code, scratch files, or test scripts. Always use local `.env` files, ensure they are explicitly listed in `.gitignore`, and use `process.env` to access them securely.

---

## 🚀 Active Roadmap & Backlog

### 1. In Progress / Upcoming
- **Smart Asset Auto-Linking**: Intelligently scan event titles (e.g., "Mega Image Groceries") against the user's Wallet assets and automatically suggest/link the corresponding loyalty card to the event.
- **Natural Language Parsing**: Use `chrono-node` to extract dates/times from event titles (e.g., "Doctor tomorrow at 3pm") and auto-fill the calendar.
- **Rapid List Entry**: Implement auto-focus and 'Enter-to-add' mechanics for checklist items to allow keyboard-only rapid entry.
- **Collapsible Week View**: Upgrade `CalendarGrid` to allow swiping/toggling between full Month view and condensed Week view to save vertical space.
- **Pull-to-Refresh & Sticky Headers**: Add a native-feeling pull-to-refresh mechanism on the home screen and sticky date headers for scrollable lists.

> **UI/UX Design Constraints (Explicit User Preferences)**
> 🚫 NO Swipe Actions (e.g. no swiping left/right to delete/complete items).
> 🚫 NO Confetti, heavy micro-animations, or overly playful gamification on completion.
> ⚠️ Haptics should be used, but kept subtle and not overdone.
> ✅ YES to clean, functional, "power-user" premium UX.

### 2. Backlog
- **Minigames**: Integrate a simple embedded game (e.g., HTML5 Canvas or React). Evaluated Rummy 45 but it is high difficulty; maybe start with Uno or Tic-Tac-Toe.
- **Android Compilation**: Wrap the web/PWA into a native Android APK build once the web version is feature-complete.
- **UI Refinement**: Continue polishing dark mode transitions and mobile responsiveness.

---

## ✅ Completed Features
- **True Push Notifications**: Implemented Firebase Cloud Messaging (FCM) and Cloud Functions to deliver OS-level push notifications to group members when a chat message is received.
- **AI Assistant**: Server-side Gemini 2.5 Flash Lite integration generating automated checklists for tasks assigned to the `ai_assistant`.
- **Checklist Management**: Added ability to edit checklist text and reorder items via up/down arrows in event modals.
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

---

## 📅 Session Log: May 8, 2026

**~09:50 - Task Started**
> Prompt: "something happened to the AI suggestion option" & "ok, can we make it work as before?"
> Plan: Refactor AI checklist generation to use a secure Firebase Callable Function (`generateAIChecklist`), allowing the "Auto-suggest Checklist via AI" button to return to the UI without exposing the Gemini API key to the client.

**~10:05 - Task Completed**
Refactored `src/ai.ts` to call the new Callable Function and pass `navigator.language` to strictly enforce AI language. Added `generateAIChecklist` to `functions/src/index.ts` with strict locale prompting. Re-enabled the client-side button in `AddEventModal.tsx`. Build verified and deployed.

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

---

## 📅 Session Log: May 6, 2026

**2026-05-06 08:50 - Task Started**
> Prompt: "here are some goals, sync them with the devlog road map and update it, also read the devlog follow those rules"
> Plan: Sync provided screenshot To-Do list with DEVLOG.md roadmap and initialize the task log.

**2026-05-06 08:51 - Task Completed**: DEVLOG roadmap synced with To-Do list (Checklist management & Rummy 45 added). Session log updated according to rules. Pushed to GitHub.

**2026-05-06 08:52 - Task Started**
> Prompt: "let's start with the checklist updates"
> Plan: Implement checklist editing and reordering functionality in AddEventModal and EventDetailsModal.

**2026-05-06 08:54 - Task Completed**: Checklist editing and reordering functions added to `AddEventModal.tsx` and `EventDetailsModal.tsx`. Tested build and deployed to Firebase successfully.

**2026-05-06 08:59 - Task Started**
> Prompt: "good, i checked out what works, but, something broke, there is more text on some items, that is now hidden, i can navigate the text via left and right keys, or mouse select and drag, but, i want it all visible, let the item height grow to acomodate all the text"
> Plan: Replace the `<input type="text">` fields in checklist rendering with auto-resizing `<textarea>` elements to accommodate multi-line text without hiding it.

**2026-05-06 09:00 - Task Completed**: `input` fields changed to `textarea` with inline auto-resize logic in both `AddEventModal.tsx` and `EventDetailsModal.tsx`. Tested build and deployed to Firebase successfully.

**2026-05-06 09:03 - Task Started**
> Prompt: "when i am editing a task/event item or anything else in it i want the modifications to auto save as soon as i make them, i don't want to only save on clicking the save event button at the bottom"
> Plan: Add a debounced `useEffect` to `AddEventModal.tsx` to automatically push changes to Firestore when `editEvent` is active. Change the Save button to "Done" during edits.

**2026-05-06 09:04 - Task Completed**: Implemented real-time autosave in `AddEventModal.tsx` using a 1-second debounce timeout. Added `autoSaveStatus` indicator next to the modified "Done" button. Built and deployed to Firebase successfully.

**2026-05-06 09:11 - Task Started**
> Prompt: "i want to be able to move events from one day to another, basically a way to change the event/task date"
> Plan: Add an editable date picker to `AddEventModal.tsx`, maintain local `eventDate` state, and include date modifications in the real-time autosave and submit logic.

**2026-05-06 09:12 - Task Completed**: Replaced the static date display in `AddEventModal.tsx` with a native `<input type="date">`. Added local state for `eventDate` which now seamlessly hooks into the new autosave engine and draft systems. Built and deployed successfully.

**2026-05-06 09:26 - Task Started**
> Prompt: "can we customize the calendar to be more in line with the theme, let's have darkmode influence the background and use the accent color somehow"
> Plan: Apply `color-scheme: dark` to `.dark` class and `accent-color` globally in `index.css` so native browser inputs (like the date picker) match the application theme perfectly.

**2026-05-06 09:27 - Task Completed**: `index.css` updated with `color-scheme` and `accent-color`. Verified build and deployed to Firebase successfully.

**2026-05-06 12:05 - Task Started**
> Prompt: "let's try 2"
> Plan: Plan and begin implementation of AI Integration (Gemini/OpenAI) for auto-suggesting task checklists and creating an "AI Assistant" feature.

**2026-05-06 12:20 - Task Started**
> Prompt: "i already have the Blaze plan"
> Plan: Set up Firebase Cloud Functions to create a robust, server-side "AI Assistant". When a task is assigned to the "ai_assistant" dummy user/group, a Firestore trigger will automatically ping Gemini and generate a checklist in the background.

**2026-05-06 12:24 - Task Completed**: Set up the `functions/` directory, updated `firebase.json`, and wrote `functions/src/index.ts`. The backend uses `firebase-functions/v2/firestore` triggers and Secret Manager to securely handle the API key and auto-generate checklists when tasks are assigned to the `ai_assistant`. Also added the AI Assistant as an assignee option in the UI.

**2026-05-06 14:41 - Task Started**
> Prompt: "same error, did you send the update?"
> Plan: Fix aggressive Firebase edge caching by adding Cache-Control headers to firebase.json, and downgrade AI model from gemini-2.5-flash (which was returning 503) to gemini-2.5-flash-lite for stability.

**2026-05-06 15:04 - Task Completed**: `gemini-2.5-flash-lite` successfully integrated. Cache busters added to `firebase.json` and `index.html`. 

**2026-05-06 15:52 - Task Started**
> Prompt: "ok, it works, let's move forward with the roadmap, and then we can improve upon what we have"
> Plan: Evaluate Rummy 45 feasibility and begin implementing OS-level True Push Notifications using Firebase Cloud Messaging (FCM) since the Cloud Functions infrastructure is now ready.

**2026-05-06 16:03 - Task Completed**: Evaluated Rummy 45 (High difficulty, documented in DEVLOG). Implemented `onMessageCreated` Firebase Cloud Function. It automatically queries the group members and dispatches FCM payloads to their devices using `sendEachForMulticast`. Web Push frontend was already configured in previous sessions. Built and deployed to Firebase successfully.

**2026-05-06 16:00 - Task Started**
> Prompt: "1, let's create a way to play not just rummy 45 but othe games as well"
> Plan: Design and implement a scalable "Games Hub" framework. Create a new Firestore collection `games` to sync real-time state, build a generic Games Lobby UI within groups, and implement Tic-Tac-Toe as the first proof-of-concept multiplayer game.

**2026-05-06 16:05 - Task Completed**: `GamesHubModal` created to show an arcade for groups. Implemented a fully functional, real-time synced `TicTacToe` game using Firestore. The architecture is modular so other games (like Rummy 45) can be easily added into the hub. Built and deployed to Firebase successfully.

**2026-05-06 16:11 - Task Started**
> Prompt: "ok, it works' let's get to rummy development"
> Plan: Plan the complex architecture and state management for Rummy 45 (Remi Etalat) and write an implementation plan artifact to confirm game rules and layout before coding the engine.

**2026-05-06 16:15 - Task Completed**: `rummy_45_plan.md` artifact generated. Wrote `RummyEngine.ts` to handle complex 106-card deck generation and shuffle logic. Created `RummyGame.tsx` component with `@hello-pangea/dnd` to render the Game Board, Lobby, and interactive drag-and-drop player hand. Connected the UI to the Games Hub. Phase 1 (Engine and Board) is fully complete.

**2026-05-06 16:21 - Task Started**
> Prompt: "we need to be able to cancel a game if it hasn't started yet, also there will be a lot of games piling up..."
> Plan: Add date-filtering to `GamesHubModal` so games are tied to `selectedDate`. Add a cancel/delete button for the owner of games in 'waiting' status.

**2026-05-06 16:23 - Task Completed**: `GamesHubModal` now accepts `selectedDate` and filters active/past games based on the calendar day. Added a red Trash icon button to allow the game creator to delete un-started games. Built and deployed.

**2026-05-06 16:25 - Task Started**
> Prompt: "ok, any more suggestions for improving this functionality?" -> "i like it"
> Plan: Implement 3 UX enhancements: Push Notifications for game invites via Cloud Functions, a persistent "Game in Progress" Banner on the Calendar screen, and an All-Time Leaderboard tab in the Arcade.

**2026-05-06 16:33 - Task Completed**: `onGameCreated` Cloud Function added and deployed to send FCM messages to group members when a game is created. Added `activeGames` banner to `CalendarHome.tsx` to surface running games outside the modal. Built a robust `Leaderboard` tab inside `GamesHubModal` that queries all finished games and ranks players by wins. Built and deployed to Firebase.

**2026-05-06 17:29 - Task Started**
> Prompt: "we are (ready for Phase 2)"
> Plan: Implement Phase 2 of Rummy 45. Add turn phases (`draw` vs `play`), clicking the Deck to draw, clicking the Discard Pile to draw the top discarded card, and dragging a card from the hand to the Discard Pile to end the turn.

**2026-05-06 17:34 - Task Started**
> Prompt: "go ahead (Phase 3)"
> Plan: Implement Meld Validation (Set vs Run, calculating points). Implement a Staging UI where players select cards from their hand and create staged melds locally. Enforce the "Initial Meld must be >= 45 points and contain a run" rule before pushing to Firestore.

**2026-05-06 17:38 - Task Completed**: `RummyEngine.ts` updated with `validateMeld` and point calculation for Sets/Runs (accounting for Jokers and Aces). UI updated: Clicking cards in your hand highlights them. If 3+ are highlighted, a bouncing "Meld X Cards" button appears. Melds are staged in a purple bar above the hand until the 45-point condition is met, after which they can be played to the board for everyone to see. Built and deployed.

**2026-05-06 17:53 - Session Wrap-up**
> Status: Leaving work. All code is successfully built, deployed, and pushed to `main`.
> Completed Today:
> 1. Universal "Games Hub" Arcade framework.
> 2. Tic-Tac-Toe multiplayer.
> 3. Cloud Functions for Game Invites (Push Notifications).
> 4. Persistent Active Game Banner in `CalendarHome`.
> 5. All-Time Arcade Leaderboard.
> 6. Rummy 45 (Phases 1-3): 106-card generation, Drag-and-drop hand sorting, Turn enforcement (Draw/Discard loop), Strict Validation (Sets/Runs), and the 45-Point Staging UI logic.
> 
> **Next Steps (To resume at home)**:
> - **Tic-Tac-Toe Polish**:
>   - Register and display scores across rounds.
>   - Add a "New Round" button to reset the board after a win/draw without needing to create a new game.
> - **Rummy 45 Visual Overhaul**:
>   - **Tile Assets**: Replace standard playing cards (Suits) with Rummy tiles (Numbers 1-13 in 4 colors: Red, Yellow, Blue, Black).
>   - **The "Tabla" (Board) Layout**: Implement a 2-row grid system for the player's personal board instead of a horizontal list.
>   - **Slot-based Organization**: Allow players to place cards in specific slots and leave empty spaces between them for better organization.
> - **Phase 4 (Lipeala)**: Allow players to drag and attach individual cards from their hand onto *existing* melds on the board.
> - **Phase 5 (End Game)**: Detect when a player discards their final card (Inchidere), end the game, tally up the negative points for remaining cards in hands, and assign the win/score to the Leaderboard.

---

## 📅 Session Log: May 7, 2026

**2026-05-07 09:02 - Task Started**
> Prompt: "check the ourdayapp folder"
> Plan: Review the repository state and identify the next steps for Rummy 45 (Phase 4 & 5).

**2026-05-07 09:41 - Task Started**
> Prompt: "you can start"
> Plan: Implement Phase 4 (Lipeala) in RummyEngine.ts and RummyGame.tsx to allow dragging cards from the hand and attaching them to existing melds.

**2026-05-07 10:42 - Task Completed**: `canAttachToMeld` validation implemented in engine. Existing melds on board converted to `Droppable` zones. Added rule blocking players from attaching their last card to enforce discarding on closing. Phase 4 done.

**2026-05-07 10:42 - Task Started**
> Prompt: "yes" (Proceed to Phase 5)
> Plan: Implement end-game scoring for Rummy 45. Add `calculatePenaltyPoints` to tally negative points for remaining cards in losers' hands when the winner discards. Update the Arcade Leaderboard to display these total points.

**2026-05-07 10:44 - Task Completed**: Phase 5 implemented. `calculatePenaltyPoints` logic uses standard Rummy values (-50 Joker, -25 Ace, -10 Faces, -5 Numbers). The Leaderboard now aggregates and displays cumulative negative points for all players across finished games. Build and deployed to Firebase.

---

**2026-05-07 14:11 - Task Started**
> Prompt: "i want to deploy the updates to Firebase now and after that i want you to start with suggestions 1,2,3. we will leave 4 for later."
> Plan: Triggering build and Firebase deployment. Next, implementing Suggestion 1: Rummy 45 Pro Mechanics (Card Sorting Button and Joker Swapping logic).

**2026-05-07 14:14 - Task Completed**: Suggestion 1 implemented. Added `sortHand` function to `RummyGame.tsx` to automatically group hand by Suit and Value. Added `canSwapJoker` logic to `RummyEngine.ts` and drag-and-drop support so users can replace a Joker in a meld with the natural card it represents and take the Joker into their hand.

**2026-05-07 14:15 - Task Completed**: Suggestion 2 and 3 implemented. 
- **Suggestion 2**: Added premium CSS micro-animations (`animate-deal` and `animate-pop-in`) to `index.css` and applied them to card draws and meld creation in Rummy 45.
- **Suggestion 3**: Refactored the Gemini prompt in Firebase Functions to output categorized shopping lists (by supermarket aisle) if it detects a grocery-related task. Added a new `ExpensesTab.tsx` integrated seamlessly into `Wallet.tsx` to serve as a Splitwise-style expense tracker for the group.
