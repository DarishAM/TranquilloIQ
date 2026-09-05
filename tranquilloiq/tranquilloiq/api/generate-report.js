import Anthropic from "@anthropic-ai/sdk";

// Streaming keeps the first byte early, so the request never trips a
// function timeout while Claude is still writing.
export const config = { maxDuration: 60 };

const SYSTEM = [
  "You write board-level business analysis for a BI dashboard.",
  "Ground every claim in the figures you are given — never invent numbers,",
  "and say so plainly when the data is too thin to support a conclusion.",
  "Flowing prose, no markdown headings, no bullet lists.",
].join(" ");

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }
  if (prompt.length > 8000) {
    return res.status(413).json({ error: "Prompt too large." });
  }

  let sentAnything = false;
  try {
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        sentAnything = true;
        res.write(event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      res.write(
        (sentAnything ? "\n\n" : "") +
          "[Claude declined to complete this analysis" +
          (final.stop_details?.explanation
            ? `: ${final.stop_details.explanation}`
            : ".") +
          "]",
      );
    }
    return res.end();
  } catch (error) {
    console.error("generate-report failed:", error);
    const status = error?.status ?? 500;
    const message =
      status === 401
        ? "Anthropic rejected the API key."
        : status === 429
          ? "Rate limited by Anthropic — try again shortly."
          : error?.message || "Report generation failed.";
    // Once bytes are on the wire we can no longer switch to a JSON error.
    if (sentAnything || res.headersSent) {
      res.write(`\n\n[Report cut short: ${message}]`);
      return res.end();
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
}
