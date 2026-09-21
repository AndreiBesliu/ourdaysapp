import { getFunctions, httpsCallable } from "firebase/functions";
import { reportError } from './reportError';
import { app } from "./firebase";
import { useThemeStore } from "./store";
import { t } from "./utils/i18n";
import { aiErrorKey } from "./utils/aiErrorKey";

// The server refuses a paid call with a stable CODE (`ai-budget/user-budget`, `/global-budget`,
// `/kill-switch`) and never with a sentence — the six languages stay the client's job. Anything
// that is not one of those codes keeps its old behaviour.
// Re-exported: callers import it from here alongside the callables it describes.
export { aiErrorKey };

export function aiErrorMessage(error: any): string {
  const lang = useThemeStore.getState().language || 'en-US';
  const key = aiErrorKey(error);
  if (key) return t(key, lang);
  return String(error?.message || '') || 'Unknown error';
}

export async function generateChecklistForTask(title: string, description: string): Promise<string[]> {
  const functions = getFunctions(app);
  const generateAIChecklist = httpsCallable(functions, 'generateAIChecklist');
  const language = useThemeStore.getState().language || 'en-US';
  
  try {
    const result = await generateAIChecklist({ title, description, language });
    const data = result.data as { suggestions: string[] };
    return data.suggestions || [];
  } catch (error: any) {
    reportError(error instanceof Error ? error.message : String(error), { context: 'ai.generateChecklistForTask' });
    console.error("AI Generation Error", error);
    // The sentence AND the key that produced it.
    //
    // This threw `new Error(aiErrorMessage(error))`, which for a refusal we recognise is the
    // finished translated sentence — so a caller that ran `aiErrorKey` over the message it caught
    // got null every time, because it was looking for a code in a sentence. The retry card
    // therefore showed its generic line for every refusal, including "you have used today's AI
    // allowance", which is the one the person can actually act on.
    //
    // Carrying the key as well lets a caller tell "we know what this is" from "this is the
    // provider's own English", without parsing anything.
    const failure = new Error(aiErrorMessage(error)) as Error & { aiKey?: string | null };
    failure.aiKey = aiErrorKey(error);
    throw failure;
  }
}

export async function suggestEventCategoryAI(title: string, description: string = ''): Promise<string> {
  const functions = getFunctions(app);
  const suggestEventCategory = httpsCallable(functions, 'suggestEventCategory');
  
  try {
    const result = await suggestEventCategory({ title, description });
    const data = result.data as { categoryId: string };
    return data.categoryId || 'other';
  } catch (error: any) {
    reportError(error instanceof Error ? error.message : String(error), { context: 'ai.suggestEventCategoryAI' });
    console.error("AI Category Suggestion Error", error);
    return 'other';
  }
}

/**
 * `truncated` means the digest covers only PART of what it was asked about.
 *
 * Two causes now, not one. Either the 48-hour chat window held more than fifty messages — the
 * server reads the newest fifty, having once read the oldest while the prompt asked what happened
 * recently — or the event list was cut. It became one flag for both on 19.09, and the sentence
 * shown to the user said “more than 50 messages” in all six languages until it was reworded. A
 * boolean that means two things needs its description updated in BOTH places, and this was the
 * one that was missed.
 */
export async function generateGroupDigestAI(groupId: string): Promise<{ digest: string; truncated: boolean }> {
  const functions = getFunctions(app);
  const generateGroupDigest = httpsCallable(functions, 'generateGroupDigest');
  const language = useThemeStore.getState().language || 'en-US';

  try {
    const result = await generateGroupDigest({ groupId, language });
    const data = result.data as { digest?: string; truncated?: boolean };
    return { digest: data.digest || '', truncated: data.truncated === true };
  } catch (error: any) {
    reportError(error instanceof Error ? error.message : String(error), { context: 'ai.generateGroupDigestAI' });
    console.error("AI Group Digest Error", error);
    throw new Error(aiErrorMessage(error));
  }
}

export async function suggestAssetForTextAI(text: string, assets: any[]): Promise<string | null> {
  if (!text || assets.length === 0) return null;
  const functions = getFunctions(app);
  const suggestAsset = httpsCallable(functions, 'suggestAssetForText');
  
  const availableAssets = assets.map(a => ({ id: a.id, name: a.name }));
  
  try {
    const result = await suggestAsset({ text, availableAssets });
    const data = result.data as { assetId: string | null };
    return data.assetId;
  } catch (error: any) {
    reportError(error instanceof Error ? error.message : String(error), { context: 'ai.suggestAssetForTextAI' });
    console.error("AI Asset Suggestion Error", error);
    return null;
  }
}

