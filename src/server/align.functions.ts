import { createServerFn } from "@tanstack/react-start";

export interface AlignedWord {
  text: string;
  start: number;
  end: number;
}

interface AlignInput {
  audioBase64: string;
  mimeType: string;
  arabicText: string; // full reference text (will be split by whitespace)
}

/**
 * Transcribes the user's recitation with ElevenLabs Scribe and aligns
 * the resulting word timings to the reference Arabic words from the
 * mushaf, returning one timestamp per reference word.
 */
export const alignRecitation = createServerFn({ method: "POST" })
  .inputValidator((data: AlignInput) => {
    if (!data?.audioBase64 || !data?.arabicText) {
      throw new Error("audioBase64 and arabicText are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

    // decode base64 -> Blob
    const buf = Buffer.from(data.audioBase64, "base64");
    const blob = new Blob([buf], { type: data.mimeType || "audio/mpeg" });

    const fd = new FormData();
    fd.append("file", blob, "recitation.mp3");
    fd.append("model_id", "scribe_v1");
    fd.append("language_code", "ara");
    fd.append("timestamps_granularity", "word");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: fd,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs STT failed [${res.status}]: ${err}`);
    }

    const json = (await res.json()) as {
      text: string;
      words?: { text: string; start: number; end: number; type?: string }[];
    };

    const sttWords = (json.words || []).filter(
      (w) => w.type !== "spacing" && w.text.trim().length > 0
    );

    // Reference words from the mushaf
    const refWords = data.arabicText
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);

    // Simple proportional alignment: distribute STT word timings across
    // reference words. This handles cases where Scribe over/under-segments.
    const aligned: AlignedWord[] = [];
    const n = refWords.length;
    const m = sttWords.length;

    if (m === 0) {
      // Fallback: distribute evenly across estimated duration
      const dur = 1; // unknown, will be replaced client-side using audio.duration
      for (let i = 0; i < n; i++) {
        aligned.push({
          text: refWords[i],
          start: (i / n) * dur,
          end: ((i + 1) / n) * dur,
        });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const sttIdx = Math.min(Math.floor((i * m) / n), m - 1);
        const sttIdxEnd = Math.min(Math.floor(((i + 1) * m) / n), m - 1);
        aligned.push({
          text: refWords[i],
          start: sttWords[sttIdx].start,
          end: sttWords[sttIdxEnd].end,
        });
      }
    }

    return { words: aligned, transcript: json.text };
  });
