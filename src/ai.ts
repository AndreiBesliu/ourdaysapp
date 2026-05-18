import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import { useThemeStore } from "./store";

export const isAIEnabled = () => true;

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
    throw new Error(`AI Error: ${error.message || 'Unknown error'}`);
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
