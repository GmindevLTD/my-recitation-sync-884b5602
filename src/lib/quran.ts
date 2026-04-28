// Quran data helpers - uses alquran.cloud API (free, CORS-enabled)
// Returns Arabic text per ayah and word-by-word audio timings via QUL/Quran.com

export interface SurahMeta {
  number: number;
  name: string;
  englishName: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface Ayah {
  number: number;
  numberInSurah: number;
  text: string;
  words: string[];
}

export interface RecitationOption {
  id: string;
  name: string;
  // alquran.cloud edition identifier with timing-segments support
  edition: string;
}

// Reciters available with verse-level audio
export const RECITERS: RecitationOption[] = [
  { id: "ar.alafasy", name: "Mishary Alafasy", edition: "ar.alafasy" },
  { id: "ar.husary", name: "Mahmoud Al-Husary", edition: "ar.husary" },
  { id: "ar.minshawi", name: "Mohamed Siddiq al-Minshawi", edition: "ar.minshawi" },
  { id: "ar.abdulbasitmurattal", name: "Abdul Basit Murattal", edition: "ar.abdulbasitmurattal" },
  { id: "ar.hudhaify", name: "Ali Al-Hudhaify", edition: "ar.hudhaify" },
];

let surahsCache: SurahMeta[] | null = null;

export async function fetchSurahs(): Promise<SurahMeta[]> {
  if (surahsCache) return surahsCache;
  const res = await fetch("https://api.alquran.cloud/v1/surah");
  const json = await res.json();
  surahsCache = json.data as SurahMeta[];
  return surahsCache;
}

export async function fetchSurahArabic(surah: number): Promise<Ayah[]> {
  const res = await fetch(`https://api.alquran.cloud/v1/surah/${surah}/quran-uthmani`);
  const json = await res.json();
  return (json.data.ayahs as { number: number; numberInSurah: number; text: string }[]).map((a) => ({
    number: a.number,
    numberInSurah: a.numberInSurah,
    text: a.text,
    words: a.text.split(/\s+/).filter(Boolean),
  }));
}

export async function fetchAyahAudio(
  surah: number,
  numberInSurah: number,
  edition: string
): Promise<string> {
  const res = await fetch(
    `https://api.alquran.cloud/v1/ayah/${surah}:${numberInSurah}/${edition}`
  );
  const json = await res.json();
  return json.data.audio as string;
}
