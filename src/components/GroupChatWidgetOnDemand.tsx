// src/components/GroupChatWidgetOnDemand.tsx
//
// The calendar's floating chat, loaded on demand (06.11.2026, BACKLOG "Bundle-ul"). The widget is the whole
// conversation — messages, pictures and voice notes, the AI digest — and it sat in the chunk everybody loads at boot,
// on the personal tab too, where there is no chat at all. Now it is fetched the first time a group tab is shown, and
// while the app is idle (App.tsx, `LAZY_PARTS`), so a later group tab finds it already here.
//
// It cannot wait for a click, as the calendar's windows do (lazyParts.ts): on a group tab the widget listens to the
// conversation while it is closed, for the unread count on its button. So it mounts as soon as its code is here, and
// counts as unread what arrived since the chat was SHOWN (`unreadSince`), not since its code came (review, 06.11.2026).
//
// Not React.lazy (the windows' way): a lazy suspends on its first render even when its chunk arrived long before — its
// factory runs only then, and the promise it makes is still pending — and React holds a fallback it has shown for
// ~300 ms so it does not flicker. The button would vanish for that long on the first group tab after every warm-up.
// Here the widget, once it has arrived, is drawn directly, in the very render that mounts it.
//
// A chunk that cannot load (no signal, or a tab older than a deploy) is thrown to the boundary around it in the
// calendar, which reports it (as 'StaleChunk': the browsers word both cases the same) and offers a reload. One load per mount, never a loop: the
// failure is thrown once and the boundary keeps its note until the tab changes (its key). The next group tab asks
// again, but on Chromium that is no retry: the browser keeps a failed module fetch for the life of the page and answers
// the same URL with the same failure, without the network (measured in the review of 06.11.2026). So the reload is the
// recovery, and nothing here spends that one fetch offline: the warm-up waits for a connection (routeWarmup.ts), and so
// does this mount (second review, 06.11.2026). Offline before the code ever came, a group tab shows no chat button
// until the connection is back, rather than a chat that stays broken after it is.
//
// The chat screen (Chat.tsx) imports the widget itself: it is a chunk of its own already, and shows nothing else.

import { useEffect, useState, type ComponentProps, type ComponentType } from 'react';
import type GroupChatWidget from './GroupChatWidget';
import { loadGroupChatWidget, loadedGroupChatWidget } from '../utils/lazyParts';
import { browserOnline, whenOnline, type OnlineEnv } from '../utils/routeWarmup';

type Props = ComponentProps<typeof GroupChatWidget>;
type Widget = ComponentType<Props>;
// Call signatures as interfaces: an arrow type before a `<` reads as JSX text to the i18n scanner (i18nCoverage).
interface LoadWidget { (): Promise<Widget> }
interface LoadedWidget { (): Widget | null }
interface Online { (): OnlineEnv }

/** The widget `load` brings, drawn directly once `loaded` has it; nothing before; a failed load thrown to the boundary. */
export function onArrival(load: LoadWidget, loaded: LoadedWidget, online: Online = browserOnline) {
  return function GroupChatWidgetOnDemand(props: Props) {
    // Read once, at mount: a widget already here is drawn in this render. Kept in state, so nothing re-chooses it and
    // remounts the conversation (with its draft and its scroll) later.
    const [Arrived, setArrived] = useState<Widget | null>(loaded);
    const [failed, setFailed] = useState<{ error: unknown } | null>(null);
    // When the chat was shown: what arrives after it is unread, whenever the code itself comes.
    const [shownAt] = useState(Date.now);

    useEffect(() => {
      if (Arrived) return;
      // Defensive: React drops a state update on an unmounted component anyway (a tab switched away mid-load).
      let live = true;
      // Online only: a fetch spent offline would be kept failed by Chromium until a reload.
      const stopWaiting = whenOnline(() => {
        load().then(
          (W) => { if (live) setArrived(() => W); },
          (error: unknown) => { if (live) setFailed({ error }); },
        );
      }, online());
      return () => { live = false; stopWaiting(); };
    }, [Arrived]);

    if (failed) throw failed.error;
    return Arrived ? <Arrived {...props} unreadSince={props.unreadSince ?? shownAt} /> : null;
  };
}

export default onArrival(loadGroupChatWidget, loadedGroupChatWidget);
