import { notFound } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { buildPrompt, countWords, FALLBACK_WORDS, MAX_WORDS } from "@/lib/promptBuilder";

export const metadata = { title: "Prompt preview · Haven" };

// Developer tool: shows the exact text Gemini Nano receives. No model is called.
// Hidden in production builds.
const SAMPLE = {
  profileFacts: ["Finals start next week", "Lives with two roommates"],
  summary:
    "Going on: finals next week, tension with a roommate\nFeeling: anxious, tired\nTried / didn't help: making a study plan\nHelped: talking to a sister\nOpen threads: whether to tell the professor about the extension",
  recent: [
    {
      role: "user" as const,
      content: "I can't focus on anything, my roommate keeps playing music.",
    },
    {
      role: "assistant" as const,
      content:
        "That sounds exhausting, trying to study with noise you can't control. What does a quiet hour look like for you right now?",
    },
    { role: "user" as const, content: "Honestly I just wish I could disappear into the library." },
  ],
  cards: [
    {
      title: "Longer breath out",
      text: "Breathe in for 4, out for 6, a few times. A longer breath out can help the body settle.",
    },
  ],
  userMessage: "What should I do about the noise before my exam?",
};

const SCENARIOS = [
  { name: "Just listen (default)", input: { ...SAMPLE, mode: "listen" as const } },
  {
    name: "Just listen, no question this time (every other reply)",
    input: { ...SAMPLE, mode: "listen" as const, askQuestion: false },
  },
  {
    name: "Just listen, offering ideas once",
    input: { ...SAMPLE, mode: "listen" as const, offerIdeas: true },
  },
  { name: "Help me think (cards included)", input: { ...SAMPLE, mode: "help" as const } },
  {
    name: "Help me think, back after 3 days",
    input: {
      ...SAMPLE,
      mode: "help" as const,
      lastTalked: "3 days ago",
      openThreads: "whether to tell the professor about the extension",
    },
  },
  {
    name: `Help me think, fallback budget (${FALLBACK_WORDS} words)`,
    input: { ...SAMPLE, mode: "help" as const, maxWords: FALLBACK_WORDS },
  },
];

export default function PromptPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-4 py-8">
      <PageTitle where="private">Prompt preview</PageTitle>
      <p className="mt-2 text-muted">
        The exact text sent to the on-device model for a sample conversation. Budget: {MAX_WORDS}{" "}
        words. Developer page, not part of the app.
      </p>
      {SCENARIOS.map(({ name, input }) => {
        const prompt = buildPrompt(input);
        return (
          <section key={name} className="mt-8">
            <h2 className="text-lg font-medium">{name}</h2>
            <p className="text-sm text-muted">{countWords(prompt)} words</p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-surface p-4 text-sm whitespace-pre-wrap">
              {prompt}
            </pre>
          </section>
        );
      })}
    </div>
  );
}
