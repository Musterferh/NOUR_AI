import { requireOwner } from '@/lib/auth';
import { apiError, HttpError, json, readBoundedBody } from '@/lib/http';
import { acquireLease, enforceQuota } from '@/lib/security';
import { AUDIO_MAX_BYTES, AUDIO_TYPES, voiceClient, voiceError } from '@/lib/voice';

export async function POST(req: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    const ownerId = await requireOwner(req);
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(415, 'Send a recorded audio file.');
    const bytes = await readBoundedBody(req, AUDIO_MAX_BYTES + 8192);
    let form: FormData;
    try { form = await new Response(new Blob([bytes as BlobPart]), { headers: { 'Content-Type': contentType } }).formData(); }
    catch { throw new HttpError(400, 'The audio upload is invalid.'); }
    const file = form.get('audio');
    if (!(file instanceof File) || !file.size) throw new HttpError(400, 'A nonempty audio recording is required.');
    if (file.size > AUDIO_MAX_BYTES) throw new HttpError(413, 'Keep recordings under 10 MB.');
    if (!AUDIO_TYPES.has(file.type.split(';')[0]) || !/\.(webm|mp4|m4a|mp3|mpeg|mpga|ogg|wav|flac)$/i.test(file.name)) throw new HttpError(415, 'This recording format is not supported.');
    const client = voiceClient();
    await enforceQuota(ownerId, 'transcribe');
    release = await acquireLease(`${ownerId}:transcribe`, 50_000);
    const transcription = await client.audio.transcriptions.create({ file, model: 'whisper-1' }, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]) });
    return json({ text: transcription.text });
  } catch (error) { return apiError(voiceError(error)); }
  finally { await release?.().catch(() => console.error('Voice lease cleanup failed.')); }
}
