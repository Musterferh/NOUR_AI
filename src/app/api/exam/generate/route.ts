import { NextResponse } from 'next/server';
import { callKimiJson, Message } from '@/lib/kimi';
import { getRelevantContext } from '@/lib/pdf-pipeline';

const EXAM_PROMPT = `You are the master examiner for the NCC Level 10 Promotion Examination. 
Based on the following CONTEXT from the Master Knowledge Bank, generate exactly 5 Multiple Choice Questions (MCQs).

**RULES:**
1. You must output STRICT VALID JSON. Do not include any text outside of the JSON array.
2. Each question MUST have exactly 4 options (A, B, C, D).
3. The 'correctAnswer' field MUST be exactly 'A', 'B', 'C', or 'D'.
4. The 'explanation' field should explain WHY it is correct and cite the context.
5. Topics should be varied across the provided context.

**JSON FORMAT REQUIRED:**
[
  {
    "question": "What is the primary function of TIRMS?",
    "options": {
      "A": "Revenue generation",
      "B": "Device tracking and management",
      "C": "Spectrum allocation",
      "D": "Customer service"
    },
    "correctAnswer": "B",
    "explanation": "TIRMS is designed to track devices to prevent counterfeiting..."
  }
]

**CONTEXT:**
{CONTEXT_PLACEHOLDER}`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { category = "General" } = body;

    // Pull high-relevance chunks for the given category (we can just query the category name to get related chunks)
    const context = await getRelevantContext(category, 10); // Pull up to 10 chunks to get broad context

    const prompt = EXAM_PROMPT.replace('{CONTEXT_PLACEHOLDER}', context || "Use baseline knowledge.");

    const messages: Message[] = [
      { role: 'user', content: prompt }
    ];

    const questions = await callKimiJson(messages);
    
    // Safety check
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("Invalid questions generated");
    }

    return NextResponse.json(questions);

  } catch (error: any) {
    console.error("Exam Generation Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate exam" }, { status: 500 });
  }
}
