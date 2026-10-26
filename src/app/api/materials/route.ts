
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateAIText } from "@/lib/gemini";

type Topic = {
  name: string;
  description: string;
  source: string;
  evidence: string;
};

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Cookies may be read-only in some server contexts.
            }
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Please sign in before uploading materials." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const uploadedFiles = formData.getAll("files");
    const materials: { name: string; text: string }[] = [];

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: "Please upload a PDF, TXT, or MD file." },
        { status: 400 }
      );
    }

    for (const item of uploadedFiles) {
      if (!(item instanceof File)) continue;

      const file = item;
      const name = file.name.toLowerCase();

      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: `${file.name} exceeds the 5 MB limit.` },
          { status: 400 }
        );
      }

      let extractedText = "";

      if (name.endsWith(".pdf")) {
        const pdfModule = await import("pdf-parse");
        const pdfParse = (
          pdfModule as unknown as {
            default?: (buffer: Buffer) => Promise<{ text: string }>;
          }
        ).default;

        if (!pdfParse) {
          throw new Error("PDF parser could not be loaded.");
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await pdfParse(buffer);
        extractedText = result.text || "";
      } else if (name.endsWith(".txt") || name.endsWith(".md")) {
        extractedText = await file.text();
      } else {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.name}` },
          { status: 400 }
        );
      }

      if (!extractedText.trim()) {
        return NextResponse.json(
          {
            error: `No readable text found in ${file.name}. Scanned PDFs may need OCR.`,
          },
          { status: 400 }
        );
      }

      materials.push({
        name: file.name,
        text: extractedText.slice(0, 12000),
      });
    }

    if (materials.length === 0) {
      return NextResponse.json(
        { error: "No valid files were uploaded." },
        { status: 400 }
      );
    }

    const sourceText = materials
      .map(
        (material) =>
          `SOURCE FILE: ${material.name}\nCONTENT:\n${material.text}`
      )
      .join("\n\n");

    const prompt = [
      "You are an educational study-material analyzer.",
      "Analyze only the uploaded source material below.",
      "Return valid JSON only, without Markdown fences.",
      'Use this structure: {"topics":[{"name":"Topic name","description":"Short explanation","source":"Exact filename","evidence":"Short exact quote from source"}]}',
      "Identify 3 to 8 topics if the content supports them.",
      "Never invent unsupported topics or quotations.",
      "Every source must match an uploaded filename exactly.",
      "",
      "UPLOADED MATERIAL:",
      sourceText.slice(0, 18000),
    ].join("\n");

    const aiResponse = await generateAIText(prompt);
    const cleanedResponse = aiResponse
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanedResponse) as {
      topics: Topic[];
    };

    if (!Array.isArray(parsed.topics)) {
      throw new Error("AI response did not contain a topics array.");
    }

    const topics = parsed.topics.filter(
      (topic) =>
        typeof topic.name === "string" &&
        typeof topic.description === "string" &&
        typeof topic.source === "string" &&
        typeof topic.evidence === "string"
    );

    // Save each uploaded material and its extracted topics.
    const savedMaterials = [];

    for (const material of materials) {
      const materialTopics = topics.filter(
        (topic) => topic.source === material.name
      );

      const { data, error } = await supabase
        .from("study_materials")
        .insert({
          user_id: user.id,
          title: material.name,
          file_name: material.name,
          extracted_topics: materialTopics,
        })
        .select("id, title")
        .single();

      if (error) {
        console.error("Supabase material save failed:", error);
        return NextResponse.json(
          {
            error: `AI analysis succeeded, but database saving failed: ${error.message}`,
          },
          { status: 500 }
        );
      }

      savedMaterials.push(data);
    }

    return NextResponse.json({
      success: true,
      materials: materials.map((material) => ({
        name: material.name,
        characters: material.text.length,
      })),
      topics,
      savedMaterials,
      message: "Study material analyzed and saved successfully.",
    });
  } catch (error) {
    console.error("Material processing failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Material processing failed. Check the server configuration.",
      },
      { status: 500 }
    );
  }
}
