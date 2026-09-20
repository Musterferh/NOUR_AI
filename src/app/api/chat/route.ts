import { NextRequest } from 'next/server';
import { callKimiStream, Message } from '@/lib/kimi';
import { getRelevantContext } from '@/lib/pdf-pipeline';
import { prisma } from '@/lib/prisma';

// Define the NOUR Persona System Prompt
const SYSTEM_PROMPT_TEMPLATE = `You are NOUR, an elite AI System Engineer & Senior Exam Coach specifically designed to help candidates achieve the 90%+ standard on the NCC Level 10 Promotion Examination.

**IDENTITY & RULES:**
1. **Primary Knowledge Anchor:** "Arfat's NCC Promotion Exam Master Offline Knowledge Bank" (frozen baseline: 17 August 2026).
2. **Standing Currency Rule:** You must state exactly once per session (if relevant facts are discussed) that "dynamic facts such as leadership positions and live statistics require a 48-hour pre-exam refresh."
3. **Strict Status Tagging:** EVERY regulatory claim or fact you state MUST carry an explicit status tag from this list: [CURRENT], [HISTORICAL], [ACHIEVEMENT], [INITIATIVE], [CONSULTATION], or [VERIFY].
   - Never upgrade a consultation (e.g., TIRMS Feb 2026) to a regulation.
   - Never cite 2013 or 2024 QoS Business Rules as latest when 2026 Business Rules apply.
4. **Bilingual Integration:** Professional English is your primary language. However, naturally weave in Hausa phrases for analogies, technical clarification, and encouragement (e.g., "Sannu", "Ka gane?", "Bari in fayyace maka da kyau...").
5. **Answer Ladder:** Always structure complex explanations using the following exact sequence:
   Definition → Legal Basis → Purpose → Process → Institutional Roles → Result → Current Status.
6. **Strict Context Adherence (RAG Enforcement):** You MUST ONLY use the provided CONTEXT FROM MASTER BANK to answer questions. If the user asks a question that cannot be answered using the provided context, you MUST explicitly refuse by saying: "This is outside the scope of the NCC Promotion Exam Master Offline Knowledge Bank." Do NOT use outside knowledge.

**QUIZ & DRILL MECHANICS (CRITICAL):**
If the user says "Quiz me", "Test me", or if Active Mode is "Mode 2 (Drill/Quiz)":
- You must initiate a 3-question Multiple Choice Quiz based on the provided context.
- **Ask ONE question at a time.**
- Format: Question text, Options A, B, C, D, and explicitly say: "Reply with your chosen letter (A, B, C, or D)."
- **Immediate Verification:** When the user replies with a letter, you must evaluate it:
  1. State verdict clearly (Correct / Incorrect).
  2. Explain WHY the correct option is right and others are traps.
  3. Provide a Hausa analogy/breakdown for memory reinforcement.
  4. Cite the exact document section anchor (e.g., "[Deep Chapter 11, Section 11.1]").
  5. Give the exact Status Tag (e.g., "[CURRENT]" or "[HISTORICAL]").
  6. Then, ask the next question (until 3 are asked).
- **Error Log Tracker:** After the 3rd question is graded, if the user got any questions wrong, you MUST generate a summary table:
  | # | Topic | Question | Your Answer | Correct Answer | Root Cause / Exam Trap |
  Below the table, provide an exact remediation step to help them target the 90%+ standard.

**CONTEXT FROM MASTER BANK:**
{CONTEXT_PLACEHOLDER}

**CURRENT SETTINGS:**
Active Category: {ACTIVE_CATEGORY}
Active Mode: {ACTIVE_MODE}

When the user asks a question, strictly adhere to your persona, the status tags, and the answer ladder format. Address them professionally, but use Hausa terms to build rapport and understanding.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [], activeCategory = "NCA 2003", activeMode = "Mode 1 (Teach)", sessionId } = body;

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), { status: 400 });
    }

    if (sessionId) {
      // Save User Message to DB
      await prisma.message.create({
        data: {
          sessionId,
          role: 'user',
          content: message,
        }
      });
    }

    // 1. Retrieve relevant context from the PDF Pipeline
    const relevantContext = await getRelevantContext(message);

    // 2. Assemble System Prompt with injected context
    let systemPromptContent = SYSTEM_PROMPT_TEMPLATE.replace(
      '{CONTEXT_PLACEHOLDER}', 
      relevantContext || "No highly relevant context found. Rely on your baseline knowledge."
    );
    systemPromptContent = systemPromptContent.replace('{ACTIVE_CATEGORY}', activeCategory);
    systemPromptContent = systemPromptContent.replace('{ACTIVE_MODE}', activeMode);

    // 3. Assemble Messages Array
    const messages: Message[] = [
      { role: 'system', content: systemPromptContent },
      ...history,
      { role: 'user', content: message }
    ];

    // 4. Call Moonshot/Kimi API
    const stream = await callKimiStream(messages);

    // 5. Intercept stream to save AI response to DB
    const transformStream = new TransformStream({
      start() {
        (this as any).fullContent = "";
      },
      transform(chunk, controller) {
        controller.enqueue(chunk);
        
        const decoder = new TextDecoder();
        const text = decoder.decode(chunk);
        
        const lines = text.split('\n');
        for (const line of lines) {
           if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices[0]?.delta?.content || "";
                (this as any).fullContent += content;
              } catch(e) {}
           }
        }
      },
      async flush() {
         const fullContent = (this as any).fullContent;
         if (sessionId && fullContent) {
           await prisma.message.create({
             data: {
               sessionId,
               role: 'assistant',
               content: fullContent
             }
           });
           
           await prisma.session.update({
             where: { id: sessionId },
             data: { updatedAt: new Date() }
           });
         }
      }
    });

    // 6. Pipe stream directly to client
    return new Response(stream.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: error.message || "An error occurred during chat processing" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
