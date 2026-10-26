"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect } from "react";

type Topic = {
  name: string;
  description: string;
  source: string;
  evidence: string;
};

const sampleTopics = [
  {
    name: "Python Fundamentals",
    score: 86,
    status: "Strong",
    color: "bg-emerald-400",
  },
  {
    name: "Loops & Conditions",
    score: 42,
    status: "Weak",
    color: "bg-rose-400",
  },
  {
    name: "Functions",
    score: 64,
    status: "Developing",
    color: "bg-amber-400",
  },
  {
    name: "Lists & Dictionaries",
    score: 35,
    status: "Weak",
    color: "bg-rose-400",
  },
];

const navItems = [
  { name: "Overview", icon: "◫" },
  { name: "My Materials", icon: "▤" },
  { name: "Topic Map", icon: "◎" },
  { name: "Diagnostic Quiz", icon: "✓" },
  { name: "Gap Report", icon: "◷" },
  { name: "Revision Plan", icon: "☷" },
];

export default function Home() {
  const [savedMaterialId, setSavedMaterialId] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const [active, setActive] = useState("Overview");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [extractedTopics, setExtractedTopics] = useState<Topic[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<
    {
      id: number;
      topic: string;
      question: string;
      options: string[];
      source: string;
      evidence: string;
    }[]
  >([]);
  const [answerKey, setAnswerKey] = useState<
    {
      id: number;
      correctAnswer: number;
      explanation: string;
      topic: string;
      source: string;
      evidence: string;
    }[]
  >([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [topicScores, setTopicScores] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreWorkspace() {
      const client = createClient();

      try {
        const {
          data: { user },
          error: authError,
        } = await client.auth.getUser();

        if (authError || !user) {
          router.replace("/login");
          return;
        }

        // Restore the latest saved study material and its extracted topics.
        const { data: materials, error: materialsError } = await client
          .from("study_materials")
          .select("id, title, file_name, extracted_topics, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (materialsError) throw materialsError;

        const latestMaterial = materials?.[0];

        if (latestMaterial && !cancelled) {
          setSavedMaterialId(latestMaterial.id as string);
          const fileName = latestMaterial.file_name || latestMaterial.title;
          setFileNames(
            typeof fileName === "string" && fileName.length > 0
              ? fileName.split(", ")
              : [],
          );
          setExtractedTopics(
            Array.isArray(latestMaterial.extracted_topics)
              ? (latestMaterial.extracted_topics as Topic[])
              : [],
          );
        }

        // Restore the latest overall quiz result.
        const { data: attempts, error: attemptsError } = await client
          .from("quiz_attempts")
          .select("score, total_questions, answers, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (attemptsError) throw attemptsError;

        const latestAttempt = attempts?.[0];
        const savedAnswers = Array.isArray(latestAttempt?.answers)
          ? (latestAttempt.answers as Array<{
              topic?: unknown;
              is_correct?: unknown;
            }>)
          : [];

        if (latestAttempt && !cancelled) {
          setQuizScore(Number(latestAttempt.score));

          const totals: Record<string, { correct: number; total: number }> = {};
          for (const answer of savedAnswers) {
            if (typeof answer.topic !== "string") continue;

            if (!totals[answer.topic]) {
              totals[answer.topic] = { correct: 0, total: 0 };
            }
            totals[answer.topic].total += 1;
            if (answer.is_correct === true) {
              totals[answer.topic].correct += 1;
            }
          }

          setTopicScores(
            Object.fromEntries(
              Object.entries(totals).map(([topicName, result]) => [
                topicName,
                result.total > 0
                  ? Math.round((result.correct / result.total) * 100)
                  : 0,
              ]),
            ),
          );
        }

        // Restore topic mastery from the table used by this project.
        const { data: masteryRows, error: masteryError } = await client
          .from("topic_mastery")
          .select("topic_name, mastery_percent")
          .eq("user_id", user.id);

        if (masteryError) throw masteryError;

        if (masteryRows?.length && !cancelled) {
          setTopicScores((previous) => {
            const restored = { ...previous };
            for (const row of masteryRows) {
              if (typeof row.topic_name === "string") {
                restored[row.topic_name] = Number(row.mastery_percent);
              }
            }
            return restored;
          });
        }
      } catch (error) {
        console.error("Could not restore saved workspace:", error);
        if (!cancelled) {
          setNotice(
            `Some saved data could not be restored: ${
              error instanceof Error ? error.message : "Unknown database error"
            }`,
          );
        }
      }
    }

    void restoreWorkspace();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function selectFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    setFileNames(selectedFiles.map((file) => file.name));
    setExtractedTopics([]);
    setQuizQuestions([]);
    setAnswerKey([]);
    setAnswers({});
    setQuizScore(null);
    setTopicScores({});
    setSavedMaterialId(null);
    setIsUploading(true);
    setNotice("Uploading and analyzing your study material...");

    try {
      const formData = new FormData();

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/materials", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Material processing failed.");
      }

      const topics: Topic[] = Array.isArray(result.topics) ? result.topics : [];

      setExtractedTopics(topics);

      // Save the processed material and extracted topics for the signed-in user.
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/login");
        throw new Error("Your session expired. Please sign in again.");
      }

      const { data: savedMaterial, error: saveMaterialError } = await supabase
        .from("study_materials")
        .insert({
          user_id: userData.user.id,
          title: selectedFiles.map((file) => file.name).join(", "),
          file_name: selectedFiles.map((file) => file.name).join(", "),
          extracted_topics: topics,
        })
        .select("id")
        .single();

      if (saveMaterialError) {
        console.error(
          "Could not save material to Supabase:",
          saveMaterialError,
        );
        setNotice(
          `Analyzed ${selectedFiles.length} file(s) and found ${topics.length} topics, but database saving failed: ${saveMaterialError.message}`,
        );
      } else {
        setSavedMaterialId(savedMaterial.id as string);
        setNotice(
          `Successfully processed ${result.materials?.length ?? selectedFiles.length} file(s), found ${topics.length} topics, and saved them to your account.`,
        );
      }
    } catch (error) {
      console.error("Material upload failed:", error);
      setNotice(
        error instanceof Error
          ? error.message
          : "Upload failed. Please check your connection and API configuration.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function prepareQuiz() {
    if (extractedTopics.length === 0) {
      setNotice("Upload study material and extract topics first.");
      return;
    }

    setIsGeneratingQuiz(true);
    setNotice("");

    try {
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: extractedTopics }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Quiz generation failed.");
      }

      if (
        !Array.isArray(result.questions) ||
        !Array.isArray(result.answerKey) ||
        result.questions.length === 0
      ) {
        throw new Error("The API did not return valid quiz questions.");
      }

      setQuizQuestions(result.questions);
      setAnswerKey(result.answerKey);
      setAnswers({});
      setQuizScore(null);
      setTopicScores({});
      setNotice(`Generated ${result.questions.length} questions. Good luck!`);
    } catch (error) {
      console.error("Quiz generation failed:", error);
      setNotice(
        error instanceof Error ? error.message : "Could not generate quiz.",
      );
    } finally {
      setIsGeneratingQuiz(false);
    }
  }

  async function submitQuiz() {
    if (quizQuestions.length === 0) return;

    if (Object.keys(answers).length < quizQuestions.length) {
      setNotice("Please answer every question before submitting.");
      return;
    }

    const results: Record<
      string,
      { correct: number; total: number; score: number }
    > = {};

    for (const question of quizQuestions) {
      const topic = question.topic;
      const key = answerKey.find((item) => item.id === question.id);

      if (!results[topic]) {
        results[topic] = { correct: 0, total: 0, score: 0 };
      }

      results[topic].total += 1;
      if (key && answers[question.id] === key.correctAnswer) {
        results[topic].correct += 1;
      }
    }

    for (const topicName of Object.keys(results)) {
      const item = results[topicName];
      item.score = Math.round((item.correct / item.total) * 100);
    }

    const correctCount = answerKey.filter(
      (item) => answers[item.id] === item.correctAnswer,
    ).length;
    const overallScore = Math.round(
      (correctCount / quizQuestions.length) * 100,
    );

    setTopicScores(
      Object.fromEntries(
        Object.entries(results).map(([topicName, result]) => [
          topicName,
          result.score,
        ]),
      ),
    );
    setQuizScore(overallScore);
    setNotice("Quiz scored. Saving your attempt and topic mastery...");

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/login");
        throw new Error(
          userError?.message || "Your session expired. Please sign in again.",
        );
      }

      const userId = userData.user.id;
      const saveErrors: string[] = [];
      let attemptSaved = false;
      let masterySaved = false;

      // Save the quiz attempt independently so a mastery-table error cannot
      // prevent the attempt from being saved (and vice versa).
      const attemptPayload = {
        user_id: userId,
        material_id: savedMaterialId,
        score: overallScore,
        total_questions: quizQuestions.length,
        answers: quizQuestions.map((question) => {
          const key = answerKey.find((item) => item.id === question.id);
          return {
            question_id: question.id,
            topic: question.topic,
            selected_option: answers[question.id],
            correct_option: key?.correctAnswer ?? null,
            is_correct: key
              ? answers[question.id] === key.correctAnswer
              : false,
          };
        }),
      };

      const { error: attemptError } = await supabase
        .from("quiz_attempts")
        .insert(attemptPayload);

      if (attemptError) {
        console.error("quiz_attempts insert failed:", attemptError);
        saveErrors.push(`quiz_attempts: ${attemptError.message}`);
      } else {
        attemptSaved = true;
      }

      // Save one mastery record per topic using the actual Supabase schema.
      // topic_mastery columns: user_id, material_id, topic_name,
      // mastery_percent, updated_at.
      const masteryRows = Object.entries(results).map(
        ([topicName, result]) => ({
          user_id: userId,
          material_id: savedMaterialId || null,
          topic_name: topicName,
          mastery_percent: result.score,
          updated_at: new Date().toISOString(),
        }),
      );

      if (masteryRows.length > 0) {
        const { error: masteryError } = await supabase
          .from("topic_mastery")
          .upsert(masteryRows, { onConflict: "user_id,topic_name" });

        if (masteryError) {
          console.error("topic_mastery upsert failed:", masteryError);
          saveErrors.push(`topic_mastery: ${masteryError.message}`);
        } else {
          masterySaved = true;
        }
      }

      if (attemptSaved && masterySaved) {
        setNotice(
          `Saved successfully: quiz score ${overallScore}% (${correctCount}/${quizQuestions.length}); quiz_attempts and topic_mastery updated.`,
        );
      } else if (saveErrors.length > 0) {
        const savedText = [
          attemptSaved ? "quiz attempt saved" : "quiz attempt NOT saved",
          masterySaved ? "topic mastery saved" : "topic mastery NOT saved",
        ].join("; ");
        setNotice(
          `Quiz score: ${overallScore}% (${correctCount}/${quizQuestions.length}). ${savedText}. Database error: ${saveErrors.join(" | ")}`,
        );
      } else {
        setNotice(
          `Quiz score: ${overallScore}%. Saving status could not be confirmed. Check the browser console and Supabase tables.`,
        );
      }
    } catch (error) {
      console.error("Could not save quiz results:", error);
      setNotice(
        `Quiz score: ${overallScore}% (${correctCount}/${quizQuestions.length}), but database saving could not complete: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  const displayedTopics =
    extractedTopics.length > 0
      ? extractedTopics.map((topic, index) => {
          const score = topicScores[topic.name];
          return {
            ...topic,
            score,
            status:
              score === undefined
                ? "Not assessed"
                : score < 50
                  ? "Needs attention"
                  : score < 80
                    ? "Developing"
                    : "Strong",
            color:
              score === undefined
                ? "bg-violet-400"
                : score < 50
                  ? "bg-rose-400"
                  : score < 80
                    ? "bg-amber-400"
                    : "bg-emerald-400",
            key: `${topic.name}-${index}`,
          };
        })
      : [];

  return (
    <main className="min-h-screen bg-[#0a0d16] text-slate-100 md:flex">
      <aside className="border-b border-white/10 bg-[#0e1220] p-5 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-xl font-bold shadow-lg shadow-violet-900/40">
            G
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              GapFinder<span className="text-violet-400"> AI</span>
            </h1>
            <p className="text-xs text-slate-500">Study smarter, not longer</p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">
            Your learning space
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Find your gaps. Focus your effort. Improve every day.
          </p>
        </div>

        <p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Workspace
        </p>

        <nav className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {navItems.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                setActive(item.name);
                setNotice("");
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                active === item.name
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-950/40"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="mt-8 hidden rounded-xl border border-white/10 p-4 md:block">
          <p className="text-sm font-medium">Demo workspace</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Sample scores are illustrative. Uploaded topics appear separately
            until diagnostic results are available.
          </p>
        </div>

        <p className="mt-5 text-xs text-slate-600">
          GapFinder AI · Hackathon Edition
        </p>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 md:px-9">
          <div>
            <p className="text-xs text-slate-500">
              YOUR PERSONAL LEARNING ANALYST
            </p>
            <h2 className="mt-1 text-xl font-semibold">{active}</h2>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isUploading ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span className="text-xs text-slate-300">
              {isUploading ? "Analyzing material..." : "Workspace ready"}
            </span>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-7 p-5 md:p-9">
          {active === "Overview" ? (
            <>
              <div className="relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-950 via-[#17162e] to-[#101827] p-6 md:p-9">
                <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />

                <div className="relative max-w-2xl">
                  <span className="inline-flex rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-xs text-violet-200">
                    ✦ Your AI-powered study companion
                  </span>

                  <h3 className="mt-5 text-3xl font-bold leading-tight tracking-tight md:text-4xl">
                    Discover what you don&apos;t know.
                    <span className="text-violet-400">.</span>
                  </h3>

                  <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                    Upload your study material, uncover knowledge gaps, and get
                    a revision plan built around what you need to learn.
                  </p>

                  <button
                    onClick={() => {
                      setActive("My Materials");
                      setNotice("");
                    }}
                    className="mt-6 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
                  >
                    Start with your material →
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "Topics extracted",
                    value:
                      extractedTopics.length > 0
                        ? String(extractedTopics.length)
                        : "—",
                    note: "From uploaded material",
                    icon: "◎",
                  },
                  {
                    label: "Materials uploaded",
                    value: String(fileNames.length),
                    note: "Current selection",
                    icon: "▤",
                  },
                  {
                    label: "Quiz status",
                    value: quizScore === null ? "Not started" : "Completed",
                    note:
                      quizScore === null
                        ? "Awaiting diagnostic quiz"
                        : `${quizQuestions.length} questions completed`,
                    icon: "✓",
                  },
                  {
                    label: "Mastery",
                    value:
                      quizScore === null ? "Not assessed" : `${quizScore}%`,
                    note:
                      quizScore === null
                        ? "Requires quiz results"
                        : "Based on diagnostic answers",
                    icon: "↗",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-white/10 bg-[#111625] p-5"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      <span className="text-xl text-violet-400">
                        {stat.icon}
                      </span>
                    </div>
                    <p className="mt-4 text-2xl font-bold">{stat.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{stat.note}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111625] p-5 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Extracted topics</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Topics identified from your uploaded study material
                    </p>
                  </div>
                  <button
                    onClick={() => setActive("My Materials")}
                    className="text-sm text-violet-300 hover:text-violet-200"
                  >
                    Manage materials →
                  </button>
                </div>

                {extractedTopics.length === 0 ? (
                  <p className="mt-5 rounded-xl border border-white/10 p-4 text-sm text-slate-400">
                    No topics extracted yet. Upload your notes to get started.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {extractedTopics.map((topic, index) => (
                      <div
                        key={`${topic.name}-${index}`}
                        className="rounded-xl border border-white/10 p-4"
                      >
                        <p className="font-medium text-violet-200">
                          {topic.name}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          {topic.description}
                        </p>
                        <p className="mt-3 text-xs text-slate-500">
                          Source: {topic.source}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111625] p-5 md:p-6">
                <h3 className="font-semibold">Next steps</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {[
                    {
                      number: "01",
                      title: "Upload material",
                      detail: "Extract topics from your notes.",
                    },
                    {
                      number: "02",
                      title: "Take a diagnostic quiz",
                      detail: "Test your understanding of each topic.",
                    },
                    {
                      number: "03",
                      title: "Review your gaps",
                      detail: "Prioritize revision based on results.",
                    },
                  ].map((item) => (
                    <div
                      key={item.number}
                      className="rounded-xl border border-white/10 p-4"
                    >
                      <p className="text-xs text-violet-300">{item.number}</p>
                      <p className="mt-2 font-medium">{item.title}</p>
                      <p className="mt-2 text-sm leading-5 text-slate-400">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-[#111625] p-6 md:p-9">
              <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">
                GapFinder workspace
              </p>

              <h3 className="mt-3 text-2xl font-bold">{active}</h3>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Upload your study notes to extract topics and their supporting
                evidence. Diagnostic scores will remain unassessed until you
                complete a quiz.
              </p>

              {active === "My Materials" && (
                <div className="mt-6">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,.txt,.md"
                    multiple
                    className="hidden"
                    disabled={isUploading}
                    onChange={(event) => {
                      void selectFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />

                  <button
                    disabled={isUploading}
                    onClick={() => fileInput.current?.click()}
                    className="w-full rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/[0.05] p-8 text-center transition hover:bg-violet-500/10 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="text-3xl">{isUploading ? "◌" : "⇧"}</span>
                    <span className="mt-3 block font-semibold">
                      {isUploading
                        ? "Analyzing your material..."
                        : "Choose your study material"}
                    </span>
                    <span className="mt-2 block text-sm text-slate-400">
                      PDF, TXT or Markdown · Up to 5 MB per file
                    </span>
                  </button>

                  {fileNames.length > 0 && (
                    <div className="mt-4 rounded-xl border border-white/10 p-4">
                      <p className="text-sm font-semibold">Selected files</p>
                      {fileNames.map((name) => (
                        <p
                          key={name}
                          className="mt-2 break-all text-sm text-slate-400"
                        >
                          📄 {name}
                        </p>
                      ))}
                    </div>
                  )}

                  {notice && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/10 p-4 text-sm text-violet-200"
                    >
                      {notice}
                    </p>
                  )}

                  {extractedTopics.length > 0 && (
                    <div className="mt-7 space-y-4">
                      <div>
                        <h4 className="text-lg font-semibold">
                          Topics found in your material
                        </h4>
                        <p className="mt-1 text-sm text-slate-400">
                          Source evidence returned by the topic analysis API.
                          These topics have not been assessed yet.
                        </p>
                      </div>

                      {extractedTopics.map((topic, index) => (
                        <article
                          key={`${topic.name}-${index}`}
                          className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
                        >
                          <h5 className="font-semibold text-violet-200">
                            {index + 1}. {topic.name}
                          </h5>

                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {topic.description}
                          </p>

                          <p className="mt-3 text-xs text-slate-400">
                            Source: {topic.source}
                          </p>

                          <blockquote className="mt-2 border-l-2 border-violet-400/50 pl-3 text-sm italic text-slate-400">
                            {topic.evidence}
                          </blockquote>
                        </article>
                      ))}

                      <button
                        onClick={() => setActive("Diagnostic Quiz")}
                        className="rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
                      >
                        Continue to diagnostic quiz →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {active === "Topic Map" && (
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {displayedTopics.length > 0
                    ? displayedTopics.map((topic) => (
                        <div
                          key={topic.key}
                          className="rounded-xl border border-white/10 p-4"
                        >
                          <p className="font-medium">{topic.name}</p>
                          <p className="mt-2 text-sm text-slate-400">
                            {topic.description}
                          </p>
                          <p
                            className={`mt-2 text-xs ${
                              topic.score === undefined
                                ? "text-violet-300"
                                : topic.score < 50
                                  ? "text-rose-300"
                                  : topic.score < 80
                                    ? "text-amber-300"
                                    : "text-emerald-300"
                            }`}
                          >
                            {topic.score === undefined
                              ? "Not assessed"
                              : `${topic.score}% · ${topic.status}`}
                          </p>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full ${topic.color}`}
                              style={{ width: `${topic.score ?? 0}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Source: {topic.source}
                          </p>
                        </div>
                      ))
                    : sampleTopics.map((topic) => (
                        <div
                          key={topic.name}
                          className="rounded-xl border border-white/10 p-4"
                        >
                          <p className="font-medium">{topic.name}</p>
                          <p className="mt-2 text-sm text-slate-400">
                            Illustrative sample score: {topic.score}% ·{" "}
                            {topic.status}
                          </p>
                        </div>
                      ))}
                </div>
              )}

              {active === "Diagnostic Quiz" && (
                <div className="mt-6 space-y-5">
                  <div className="rounded-xl border border-white/10 p-4">
                    <p className="text-sm text-slate-300">
                      {extractedTopics.length > 0
                        ? `${extractedTopics.length} extracted topics are ready for a quiz based on your uploaded material.`
                        : "Upload study material first to generate a quiz from its content."}
                    </p>

                    <button
                      disabled={
                        extractedTopics.length === 0 || isGeneratingQuiz
                      }
                      onClick={prepareQuiz}
                      className="mt-4 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isGeneratingQuiz
                        ? "Generating questions..."
                        : quizQuestions.length > 0
                          ? "Generate a new quiz"
                          : "Generate diagnostic quiz"}
                    </button>
                  </div>

                  {notice && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="rounded-xl border border-violet-400/20 bg-violet-400/10 p-4 text-sm text-violet-200"
                    >
                      {notice}
                    </p>
                  )}

                  {quizQuestions.map((question, index) => {
                    const key = answerKey.find(
                      (item) => item.id === question.id,
                    );

                    return (
                      <article
                        key={question.id}
                        className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
                      >
                        <p className="text-xs text-violet-300">
                          Question {index + 1} of {quizQuestions.length} ·{" "}
                          {question.topic}
                        </p>

                        <h4 className="mt-2 font-semibold leading-6">
                          {question.question}
                        </h4>

                        <div className="mt-4 space-y-2">
                          {question.options.map((option, optionIndex) => (
                            <label
                              key={`${question.id}-${optionIndex}`}
                              className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                                quizScore !== null &&
                                key?.correctAnswer === optionIndex
                                  ? "border-emerald-400/50 bg-emerald-400/10"
                                  : "border-white/10 hover:bg-white/5"
                              } ${quizScore === null ? "cursor-pointer" : "cursor-default"}`}
                            >
                              <input
                                type="radio"
                                name={`question-${question.id}`}
                                checked={answers[question.id] === optionIndex}
                                disabled={quizScore !== null}
                                onChange={() =>
                                  setAnswers((previous) => ({
                                    ...previous,
                                    [question.id]: optionIndex,
                                  }))
                                }
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>

                        {quizScore !== null && key && (
                          <div className="mt-4 space-y-2 rounded-lg bg-white/5 p-3 text-sm">
                            <p
                              className={
                                answers[question.id] === key.correctAnswer
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {answers[question.id] === key.correctAnswer
                                ? "Correct answer"
                                : "Incorrect answer"}
                            </p>
                            <p className="text-slate-300">{key.explanation}</p>
                            <p className="text-xs text-slate-400">
                              Source: {key.source}
                            </p>
                            <blockquote className="border-l-2 border-violet-400/50 pl-3 text-xs italic text-slate-400">
                              {key.evidence}
                            </blockquote>
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {quizQuestions.length > 0 && quizScore === null && (
                    <button
                      onClick={submitQuiz}
                      className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Submit answers
                    </button>
                  )}

                  {quizScore !== null && (
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                      <p className="text-sm text-emerald-200">
                        Your diagnostic score
                      </p>
                      <p className="mt-2 text-3xl font-bold">{quizScore}%</p>
                      <p className="mt-2 text-sm text-slate-300">
                        {quizScore >= 80
                          ? "Strong performance. Review explanations to reinforce learning."
                          : quizScore >= 50
                            ? "Developing understanding. Focus on topics where you lost marks."
                            : "Prioritize revision of the topics below before retaking the quiz."}
                      </p>
                      <button
                        onClick={() => setActive("Gap Report")}
                        className="mt-4 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400"
                      >
                        View topic gap report →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {active === "Gap Report" && (
                <div className="mt-6 space-y-3">
                  {extractedTopics.length === 0 ? (
                    <p className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">
                      Upload study material and complete a diagnostic quiz to
                      generate a gap report.
                    </p>
                  ) : Object.keys(topicScores).length === 0 ? (
                    <p className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">
                      Your topics are extracted, but not assessed yet. Complete
                      the diagnostic quiz to calculate topic-level scores.
                    </p>
                  ) : (
                    extractedTopics.map((topic, index) => {
                      const score = topicScores[topic.name];
                      return (
                        <div
                          key={`${topic.name}-${index}`}
                          className="rounded-xl border border-white/10 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{topic.name}</p>
                            <span
                              className={`text-sm font-semibold ${score === undefined ? "text-slate-400" : score < 50 ? "text-rose-300" : score < 80 ? "text-amber-300" : "text-emerald-300"}`}
                            >
                              {score === undefined
                                ? "Not assessed in quiz"
                                : `${score}% · ${score < 50 ? "Needs attention" : score < 80 ? "Developing" : "Strong"}`}
                            </span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full ${score === undefined ? "bg-slate-600" : score < 50 ? "bg-rose-400" : score < 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                              style={{ width: `${score ?? 0}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs text-slate-400">
                            {topic.description}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {active === "Revision Plan" && (
                <div className="mt-6 rounded-xl border border-white/10 p-4">
                  <p className="text-sm leading-6 text-slate-400">
                    This revision order is based on your diagnostic quiz results
                    when available. Topics without a quiz score are shown as
                    unassessed.
                  </p>
                  {extractedTopics.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {[...extractedTopics]
                        .sort(
                          (a, b) =>
                            (topicScores[a.name] ?? -1) -
                            (topicScores[b.name] ?? -1),
                        )
                        .map((topic, index) => {
                          const score = topicScores[topic.name];
                          return (
                            <div
                              key={`${topic.name}-${index}`}
                              className="rounded-xl border border-white/10 p-4"
                            >
                              <p className="text-xs text-violet-300">
                                Priority {index + 1}
                              </p>
                              <p className="mt-1 font-medium">{topic.name}</p>
                              <p className="mt-2 text-sm text-slate-400">
                                {score === undefined
                                  ? "Not assessed: take the diagnostic quiz."
                                  : score < 50
                                    ? `High priority · ${score}% score. Revisit the source material and practice more questions.`
                                    : score < 80
                                      ? `Medium priority · ${score}% score. Review key concepts and practice.`
                                      : `Maintenance · ${score}% score. Review briefly to retain knowledge.`}
                              </p>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  {extractedTopics.length > 0 && quizScore === null && (
                    <button
                      onClick={() => setActive("Diagnostic Quiz")}
                      className="mt-4 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-400"
                    >
                      Take diagnostic quiz →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
