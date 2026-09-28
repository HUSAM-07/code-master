export type AiConfig = {
  provider: "openai" | "anthropic";
  key: string;
  model?: string;
};

export async function generate(config: AiConfig, system: string, user: string) {
  const anthropic = config.provider === "anthropic";
  const response = await fetch(
    anthropic
      ? "https://api.anthropic.com/v1/messages"
      : "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: anthropic
        ? {
            "Content-Type": "application/json",
            "x-api-key": config.key,
            "anthropic-version": "2023-06-01",
          }
        : {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.key}`,
          },
      body: JSON.stringify(
        anthropic
          ? {
              model: config.model || "claude-sonnet-5",
              max_tokens: 8192,
              system,
              messages: [{ role: "user", content: user }],
            }
          : {
              model: config.model || "gpt-4.1",
              temperature: 0.2,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            },
      ),
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok)
    throw new Error(
      `AI provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    content?: { type: string; text?: string }[];
  };
  const text = anthropic
    ? data.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    : data.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI provider returned no text");
  return text;
}

export function parseJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}
