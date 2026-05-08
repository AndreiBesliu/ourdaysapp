import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

export const isAIEnabled = () => true;

export async function generateChecklistForTask(title: string, description: string): Promise<string[]> {
  const functions = getFunctions(app);
  const generateAIChecklist = httpsCallable(functions, 'generateAIChecklist');
  const language = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  
  try {
    const result = await generateAIChecklist({ title, description, language });
    const data = result.data as { suggestions: string[] };
    return data.suggestions || [];
  } catch (error: any) {
    console.error("AI Generation Error", error);
    throw new Error(`AI Error: ${error.message || 'Unknown error'}`);
  }
}
