import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
let genAI: GoogleGenerativeAI | null = null;

if (API_KEY) {
  genAI = new GoogleGenerativeAI(API_KEY);
}

export const isAIEnabled = () => !!genAI;

export async function generateChecklistForTask(title: string, description: string): Promise<string[]> {
  if (!genAI) throw new Error("AI is not configured. Missing VITE_GEMINI_API_KEY in .env.local.");
  
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const prompt = `You are a helpful assistant for a family organization app. 
The user is creating a task/event titled "${title}".
${description ? `The description is: "${description}".` : ''}
Generate a checklist of 3 to 7 actionable, brief steps or items needed for this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Buy milk", "Get eggs", "Pay the cashier"]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Clean potential markdown blocks
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const list = JSON.parse(cleanText);
    if (Array.isArray(list)) {
      return list.map(i => String(i));
    }
    return [];
  } catch (error) {
    console.error("AI Generation Error", error);
    throw new Error("Failed to generate checklist.");
  }
}
