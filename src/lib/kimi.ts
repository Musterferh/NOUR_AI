export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface KimiStreamPayload {
  model: string;
  messages: Message[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

export async function callKimiStream(messages: Message[]): Promise<ReadableStream> {
  const KIMI_API_KEY = process.env.KIMI_API_KEY;
  const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1/chat/completions";
  const KIMI_MODEL = process.env.KIMI_MODEL || "moonshot-v1-128k";

  if (!KIMI_API_KEY) {
    throw new Error("Missing KIMI_API_KEY environment variable. Please set it in your .env.local file.");
  }

  const payload: KimiStreamPayload = {
    model: KIMI_MODEL,
    messages,
    stream: true,
    temperature: 0.3,
  };

  const response = await fetch(KIMI_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIMI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kimi API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("Kimi API returned an empty response body");
  }

  return response.body;
}

export async function callKimiJson(messages: Message[]): Promise<any> {
  const KIMI_API_KEY = process.env.KIMI_API_KEY;
  const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1/chat/completions";
  const KIMI_MODEL = process.env.KIMI_MODEL || "moonshot-v1-128k";

  if (!KIMI_API_KEY) {
    throw new Error("Missing KIMI_API_KEY environment variable. Please set it in your .env.local file.");
  }

  const payload: KimiStreamPayload = {
    model: KIMI_MODEL,
    messages,
    stream: false,
    temperature: 0.2, // Very low temperature for strict JSON adherence
  };

  const response = await fetch(KIMI_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIMI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kimi API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || "";
  
  try {
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = content.substring(startIdx, endIdx + 1);
      return JSON.parse(jsonStr);
    }
    
    // Fallback
    const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse Kimi JSON:", content);
    throw new Error("Invalid JSON returned from model");
  }
}
