import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { scoringsystemprompt } from "../prompt/promptJira";


const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

export async function getAcceptanceScore(ac: string) {

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system" as const,
      content: scoringsystemprompt()
    },
    {
      role: "user" as const,
      content: ac
    }
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages
  });

  const text = response.choices[0].message?.content?.trim() || "";

  
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
