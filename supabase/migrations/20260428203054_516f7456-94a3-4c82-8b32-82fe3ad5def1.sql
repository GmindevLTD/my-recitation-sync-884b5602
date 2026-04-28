
CREATE TABLE public.user_recitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  surah_number INT NOT NULL,
  ayah_start INT NOT NULL DEFAULT 1,
  ayah_end INT NOT NULL,
  audio_url TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  alignment JSONB NOT NULL,
  duration_sec REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_recitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view recitations" ON public.user_recitations FOR SELECT USING (true);
CREATE POLICY "Anyone can create recitations" ON public.user_recitations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete recitations" ON public.user_recitations FOR DELETE USING (true);

INSERT INTO storage.buckets (id, name, public) VALUES ('recitations', 'recitations', true);

CREATE POLICY "Public read recitations" ON storage.objects FOR SELECT USING (bucket_id = 'recitations');
CREATE POLICY "Anyone can upload recitations" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'recitations');
CREATE POLICY "Anyone can delete recitations" ON storage.objects FOR DELETE USING (bucket_id = 'recitations');
