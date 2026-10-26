import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAIText } from "@/lib/gemini";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(12000),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a prompt between 1 and 12000 characters." },
        { status: 400 }
      );
    }

    const answer = await generateAIText(parsed.data.prompt);

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("AI endpoint error:", error);

    return NextResponse.json(
      { error: "AI request failed. Check your server configuration." },
      { status: 500 }
    );
  }
}
