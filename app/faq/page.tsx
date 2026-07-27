import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "Answers about listing discovery, saved data, local AI, authenticity research, marketplace coverage, and resale estimates in ResaleMasterLab.",
  alternates: { canonical: "/faq" },
};

const questions = [
  {
    question: "Does ResaleMasterLab guarantee that an item will sell?",
    answer: "No. Prices, scores, profit estimates, engagement signals, and AI comments are research aids. Demand, fees, condition, authenticity, shipping, and the final sale price can change.",
  },
  {
    question: "Does the authenticity check certify an item as genuine?",
    answer: "No. It compares a listing with public retailer and release references and highlights missing evidence. A qualified physical authenticator or the marketplace remains responsible for any certification.",
  },
  {
    question: "Where is my saved workspace stored?",
    answer: "Preferences, favorites, watched listings, recent searches, and local AI instructions are saved in browser storage on the current device. The workspace includes a reset control for deleting that data.",
  },
  {
    question: "Does AI Search require the local model?",
    answer: "No. AI Search can discover public priced listing pages with the exact query. Loading the private browser model adds bounded query expansion, relevance review, and clearer evidence summaries.",
  },
  {
    question: "Which marketplaces are available?",
    answer: "Depop, Grailed, and Poshmark are the default sources. International Markets adds Mercari Japan, JDirectItems Auction, Rakuten, Rakuten Rakuma, Bunjang, Goofish, and optional public-web AI Search.",
  },
  {
    question: "Why are some engagement or listing-date fields unknown?",
    answer: "A field stays unknown when the public source page does not publish a readable value. ResaleMasterLab does not sign in, bypass access controls, or invent missing metrics.",
  },
];

export default function Page() {
  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <PublicShell eyebrow="Straightforward product answers" title="Frequently asked questions" description="Answers about marketplace coverage, saved data, local AI, evidence quality, and the limits of resale estimates.">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqData) }} />
      {questions.map((item) => (
        <section key={item.question}>
          <h2>{item.question}</h2>
          <p>{item.answer}</p>
        </section>
      ))}
    </PublicShell>
  );
}
