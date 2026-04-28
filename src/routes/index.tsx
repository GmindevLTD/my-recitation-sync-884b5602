import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mic, Play, Pause, Upload, Trash2 } from "lucide-react";
import {
  fetchSurahs,
  fetchSurahArabic,
  fetchAyahAudio,
  RECITERS,
  type Ayah,
  type SurahMeta,
} from "@/lib/quran";
import { alignRecitation, type AlignedWord } from "@/server/align.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ayat — Récitation du Coran avec synchronisation" },
      {
        name: "description",
        content:
          "Lis le Coran avec surlignage mot par mot. Écoute des récitateurs ou ajoute ta propre récitation et synchronise-la automatiquement.",
      },
    ],
  }),
  component: HomePage,
});

interface UserRecitation {
  id: string;
  name: string;
  surah_number: number;
  ayah_start: number;
  ayah_end: number;
  audio_url: string;
  audio_path: string;
  alignment: AlignedWord[];
}

function HomePage() {
  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
  const [surahNum, setSurahNum] = useState<number>(1);
  const [ayahs, setAyahs] = useState<Ayah[]>([]);
  const [reciter, setReciter] = useState<string>("ar.alafasy");
  const [activeAyah, setActiveAyah] = useState<number>(1);
  const [activeWord, setActiveWord] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [loadingSurah, setLoadingSurah] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);

  // user recitations
  const [myRecitations, setMyRecitations] = useState<UserRecitation[]>([]);
  const [activeCustom, setActiveCustom] = useState<UserRecitation | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recName, setRecName] = useState("");

  // ---- load surah list ----
  useEffect(() => {
    fetchSurahs().then(setSurahs).catch((e) => toast.error(e.message));
  }, []);

  // ---- load surah text ----
  useEffect(() => {
    setLoadingSurah(true);
    setActiveAyah(1);
    setActiveWord(-1);
    fetchSurahArabic(surahNum)
      .then((a) => setAyahs(a))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingSurah(false));
  }, [surahNum]);

  // ---- load my recitations for this surah ----
  useEffect(() => {
    supabase
      .from("user_recitations")
      .select("*")
      .eq("surah_number", surahNum)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMyRecitations((data as unknown as UserRecitation[]) || []);
        setActiveCustom(null);
      });
  }, [surahNum]);

  // ---- play built-in reciter (ayah by ayah, distribute words evenly) ----
  const playReciter = async () => {
    if (!ayahs.length) return;
    setPlaying(true);
    for (let i = 0; i < ayahs.length; i++) {
      const ayah = ayahs[i];
      setActiveAyah(ayah.numberInSurah);
      const url = await fetchAyahAudio(surahNum, ayah.numberInSurah, reciter);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => {
          const dur = audio.duration || 1;
          const wordDur = dur / ayah.words.length;
          let w = 0;
          setActiveWord(0);
          const interval = setInterval(() => {
            w = Math.min(
              ayah.words.length - 1,
              Math.floor(audio.currentTime / wordDur)
            );
            setActiveWord(w);
          }, 80);
          audio.onended = () => {
            clearInterval(interval);
            resolve();
          };
          audio.onerror = () => {
            clearInterval(interval);
            reject(new Error("audio error"));
          };
          audio.play().catch(reject);
        };
      }).catch(() => {});
      if (audioRef.current !== audio) break; // stopped
    }
    setPlaying(false);
    setActiveWord(-1);
  };

  const stopReciter = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setActiveWord(-1);
  };

  // ---- play custom recitation with stored alignment ----
  const playCustom = (rec: UserRecitation) => {
    setActiveCustom(rec);
    setActiveAyah(rec.ayah_start);
    const audio = new Audio(rec.audio_url);
    customAudioRef.current = audio;
    setPlaying(true);
    audio.ontimeupdate = () => {
      const t = audio.currentTime;
      const idx = rec.alignment.findIndex((w) => t >= w.start && t <= w.end);
      if (idx >= 0) {
        // figure out which ayah this word belongs to
        let cum = 0;
        for (const ay of ayahs.filter(
          (a) => a.numberInSurah >= rec.ayah_start && a.numberInSurah <= rec.ayah_end
        )) {
          if (idx < cum + ay.words.length) {
            setActiveAyah(ay.numberInSurah);
            setActiveWord(idx - cum);
            break;
          }
          cum += ay.words.length;
        }
      }
    };
    audio.onended = () => {
      setPlaying(false);
      setActiveWord(-1);
    };
    audio.play();
  };

  const stopCustom = () => {
    customAudioRef.current?.pause();
    customAudioRef.current = null;
    setPlaying(false);
    setActiveWord(-1);
  };

  // ---- upload + align ----
  const onUploadFile = async (file: File) => {
    if (!ayahs.length) return;
    if (!recName.trim()) {
      toast.error("Donne un nom à ta récitation");
      return;
    }
    setUploading(true);
    try {
      // 1. Read base64
      const buf = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), "")
      );

      // for the MVP we align over the whole surah currently displayed
      const ayahStart = ayahs[0].numberInSurah;
      const ayahEnd = ayahs[ayahs.length - 1].numberInSurah;
      const referenceText = ayahs.map((a) => a.text).join(" ");

      toast.info("Transcription et alignement en cours…");
      const result = await alignRecitation({
        data: {
          audioBase64: base64,
          mimeType: file.type || "audio/mpeg",
          arabicText: referenceText,
        },
      });

      // 2. Upload to storage
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("recitations")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("recitations").getPublicUrl(path);

      // 3. Insert
      const { data: row, error: insErr } = await supabase
        .from("user_recitations")
        .insert([
          {
            name: recName,
            surah_number: surahNum,
            ayah_start: ayahStart,
            ayah_end: ayahEnd,
            audio_url: pub.publicUrl,
            audio_path: path,
            alignment: result.words as unknown as never,
          },
        ])
        .select()
        .single();
      if (insErr) throw insErr;

      setMyRecitations((prev) => [row as unknown as UserRecitation, ...prev]);
      setRecName("");
      toast.success("Récitation ajoutée et synchronisée !");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const deleteRecitation = async (rec: UserRecitation) => {
    await supabase.storage.from("recitations").remove([rec.audio_path]);
    await supabase.from("user_recitations").delete().eq("id", rec.id);
    setMyRecitations((p) => p.filter((r) => r.id !== rec.id));
    if (activeCustom?.id === rec.id) stopCustom();
  };

  const currentSurahMeta = useMemo(
    () => surahs.find((s) => s.number === surahNum),
    [surahs, surahNum]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <Toaster richColors position="top-center" />

      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Ayat</h1>
            <p className="text-xs text-muted-foreground">
              Récitation du Coran avec synchronisation mot-par-mot
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Left panel */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sourate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={String(surahNum)}
                onValueChange={(v) => setSurahNum(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {surahs.map((s) => (
                    <SelectItem key={s.number} value={String(s.number)}>
                      {s.number}. {s.englishName} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentSurahMeta && (
                <p className="text-xs text-muted-foreground">
                  {currentSurahMeta.numberOfAyahs} versets ·{" "}
                  {currentSurahMeta.revelationType}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Récitateur</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs defaultValue="builtin">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="builtin">Intégrés</TabsTrigger>
                  <TabsTrigger value="mine">Mes récitations</TabsTrigger>
                </TabsList>

                <TabsContent value="builtin" className="space-y-3 pt-3">
                  <Select value={reciter} onValueChange={setReciter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECITERS.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {playing && !activeCustom ? (
                    <Button onClick={stopReciter} variant="secondary" className="w-full">
                      <Pause className="w-4 h-4 mr-2" /> Stop
                    </Button>
                  ) : (
                    <Button onClick={playReciter} className="w-full" disabled={loadingSurah}>
                      <Play className="w-4 h-4 mr-2" /> Lire
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="mine" className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <Label htmlFor="recname" className="text-xs">
                      Nom de ma récitation
                    </Label>
                    <Input
                      id="recname"
                      value={recName}
                      onChange={(e) => setRecName(e.target.value)}
                      placeholder="Ex: Ma voix - Al-Fatiha"
                    />
                    <Label
                      htmlFor="recfile"
                      className="flex items-center justify-center gap-2 cursor-pointer rounded-md border border-dashed py-3 text-sm hover:bg-accent"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Synchronisation…
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" /> Choisir un audio
                        </>
                      )}
                    </Label>
                    <input
                      id="recfile"
                      type="file"
                      accept="audio/*"
                      hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUploadFile(f);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div className="space-y-1.5 pt-2">
                    {myRecitations.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Aucune récitation pour cette sourate.
                      </p>
                    )}
                    {myRecitations.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-1 rounded-md border bg-card px-2 py-1.5 text-sm"
                      >
                        <Mic className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="flex-1 truncate">{r.name}</span>
                        {activeCustom?.id === r.id && playing ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={stopCustom}
                            className="h-7 w-7 p-0"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => playCustom(r)}
                            className="h-7 w-7 p-0"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteRecitation(r)}
                          className="h-7 w-7 p-0 text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </aside>

        {/* Right: Quran reader */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-center text-2xl">
                {currentSurahMeta?.name}
              </CardTitle>
              <p className="text-center text-sm text-muted-foreground">
                {currentSurahMeta?.englishName}
              </p>
            </CardHeader>
            <CardContent>
              {loadingSurah ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div dir="rtl" className="space-y-5 text-right leading-loose">
                  {ayahs.map((a) => (
                    <p
                      key={a.number}
                      className={`text-2xl md:text-3xl transition-colors ${
                        activeAyah === a.numberInSurah
                          ? "text-foreground"
                          : "text-foreground/70"
                      }`}
                    >
                      {a.words.map((w, i) => {
                        const isActive =
                          activeAyah === a.numberInSurah && activeWord === i;
                        return (
                          <span
                            key={i}
                            className={`inline-block mx-1 rounded px-1 transition-all ${
                              isActive
                                ? "bg-primary text-primary-foreground scale-110"
                                : ""
                            }`}
                          >
                            {w}
                          </span>
                        );
                      })}
                      <span className="inline-block mx-2 text-sm text-muted-foreground align-middle">
                        ﴿{a.numberInSurah}﴾
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
