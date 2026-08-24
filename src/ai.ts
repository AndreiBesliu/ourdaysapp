import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import { useThemeStore } from "./store";
import { t } from "./utils/i18n";

// The server refuses a paid call with a stable CODE (`ai-budget/user-budget`, `/global-budget`,
// `/kill-switch`) and never with a sentence — the six languages stay the client's job. Anything
// that is not one of those codes keeps its old behaviour.
export function aiErrorMessage(error: any): string {
  const lang = useThemeStore.getState().language || 'en-US';
  const raw = String(error?.message || '');
  if (raw.includes('ai-budget/user-budget')) return t('aiBudgetUser', lang);
  if (raw.includes('ai-budget/global-budget')) return t('aiBudgetGlobal', lang);
  if (raw.includes('ai-budget/kill-switch')) return t('aiBudgetOff', lang);
  return raw || 'Unknown error';
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
    console.error("AI Generation Error", error);
    throw new Error(aiErrorMessage(error));
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
    console.error("AI Category Suggestion Error", error);
    return 'other';
  }
}

export async function generateGroupDigestAI(groupId: string): Promise<string> {
  const functions = getFunctions(app);
  const generateGroupDigest = httpsCallable(functions, 'generateGroupDigest');
  const language = useThemeStore.getState().language || 'en-US';
  
  try {
    const result = await generateGroupDigest({ groupId, language });
    const data = result.data as { digest: string };
    return data.digest || 'No recent activity.';
  } catch (error: any) {
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
    console.error("AI Asset Suggestion Error", error);
    return null;
  }
}

