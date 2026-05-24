import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEARN_PROMPT = `Use the Understand-Anything learning workflow for this request.

Goal: help the user learn a codebase, folder, concept, architecture, or knowledge base.

Rules:
1. If the user named a repo/path/folder, inspect that target first.
2. Prefer Understand-Anything skills when available: understand, understand-dashboard, understand-chat, understand-explain, understand-onboard, understand-domain, understand-knowledge, understand-diff.
3. For codebase learning, build or refresh the graph before explaining unless a fresh graph already exists.
4. For conceptual learning, produce a guided path: overview -> key concepts -> relationships -> examples -> next questions.
5. Keep explanations short by default and offer deeper drill-downs.

User learning request:`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("learn", {
    description: "Start a learning/onboarding flow using Understand-Anything when available",
    handler: async (args, ctx) => {
      const request = args.trim();

      if (!request) {
        ctx.ui.notify("Usage: /learn <what you want to learn>", "warning");
        return;
      }

      const message = `${LEARN_PROMPT}\n${request}`;

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        ctx.ui.notify("Learning request queued", "info");
      }
    },
  });

  pi.registerCommand("learn-codebase", {
    description: "Learn the current codebase with an architecture/onboarding focus",
    handler: async (args, ctx) => {
      const target = args.trim() || "the current working directory";
      const message = `${LEARN_PROMPT}\nTeach me ${target}. Build or refresh the Understand-Anything graph if needed, then explain the architecture and best onboarding path.`;

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        ctx.ui.notify("Codebase learning request queued", "info");
      }
    },
  });
}
