import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { apiError, readJson } from '@/lib/http';
import { acquireLease, enforceQuota } from '@/lib/security';
import { voiceClient, voiceError } from '@/lib/voice';

export async function POST(req: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    const ownerId = await requireOwner(req);
    const { text } = await readJson(req, z.object({ text: z.string().trim().min(1).max(4000) }).strict(), 20_000);
    const client = voiceClient();
    await enforceQuota(ownerId, 'speech');
    release = await acquireLease(`${ownerId}:speech`, 50_000);
    const mp3 = await client.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: text, response_format: 'mp3' }, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]) });
    return new Response(await mp3.arrayBuffer(), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(voiceError(error)); }
  finally { await release?.().catch(() => console.error('Voice lease cleanup failed.')); }
}
