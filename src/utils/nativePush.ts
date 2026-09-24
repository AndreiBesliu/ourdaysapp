// src/utils/nativePush.ts
//
// Native (Capacitor) push registration, in the one order that works: clear the listeners left by
// an earlier sign-in, attach this sign-in's, THEN register.
//
// It ran the other way until 24.09.2026 — `register()` first, then `removeAllListeners()`, then
// the new listener. `register()` is what fires the 'registration' event, so on a phone that had
// already seen a sign-in the token went to the PREVIOUS account's listener (its write refused: that
// account is signed out) and, when the event beat the new listener, not to this one at all. The
// phone then never received this account's pushes. Found by the pre-deploy review. The APK ships a
// frozen bundle, so this reaches phones only with the rebuild — see OWNER_VERIFY.md.

/** The part of `@capacitor/push-notifications` used here; the tests pass a fake. */
export interface PushPlugin {
  requestPermissions(): Promise<{ receive: string }>;
  removeAllListeners(): Promise<void>;
  addListener(event: 'registration', fn: (token: { value: string }) => void): Promise<unknown>;
  addListener(event: 'pushNotificationReceived', fn: (notification: unknown) => void): Promise<unknown>;
  register(): Promise<void>;
}

/** Returns whether it registered (false when the person did not grant permission). */
export async function registerNativePush(
  plugin: PushPlugin,
  onToken: (token: string) => void | Promise<void>,
): Promise<boolean> {
  const perm = await plugin.requestPermissions();
  if (perm.receive !== 'granted') return false;
  // This runs on EVERY sign-in. It used to stack one more listener each time — a phone that had
  // seen three sign-ins wrote the token three times — and, before this order, cleared them only
  // after the event had already fired.
  await plugin.removeAllListeners();
  await plugin.addListener('registration', (token) => { void onToken(token.value); });
  await plugin.addListener('pushNotificationReceived', (n) => { console.log('Push received: ', n); });
  await plugin.register();
  return true;
}
