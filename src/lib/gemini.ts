
import { GoogleGenAI } from "@google/genai";

export function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY environment variable.");
  }

  return new GoogleGenAI({ apiKey });
}

export async function generateAIText(prompt: string): Promise<string> {
  if (!prompt.trim()) {
    throw new Error("Prompt cannot be empty.");
  }

  const ai = getGeminiClient();

  // Try the primary model first.
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });

    return response.text ?? "";
  } catch (error) {
    console.error("Primary Gemini model failed:", error);
  }

  // Fall back if the primary model fails.
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
    });

    return response.text ?? "";
  } catch (error) {
    console.error("Fallback Gemini model failed:", error);

    throw new Error(
      "AI analysis is temporarily unavailable. Please try again shortly."
    );
  }
}
