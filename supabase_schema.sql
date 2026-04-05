-- ============================================================
-- Online Test Maker — Supabase PostgreSQL Schema
-- Çalıştırma: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- 1. PROFILES
-- ────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  role        text not null check (role in ('teacher','student')) default 'teacher',
  avatar_url  text,
  created_at  timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Kendi profilini görüntüle" on public.profiles for select using (auth.uid() = id);
create policy "Kendi profilini güncelle"  on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- 2. CLASSES
-- ────────────────────────────────────────────────────────────
create table public.classes (
  id          uuid primary key default uuid_generate_v4(),
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  class_name  text not null,
  created_at  timestamptz default now()
);
alter table public.classes enable row level security;
create policy "Öğretmen kendi sınıflarını yönetir" on public.classes
  for all using (auth.uid() = teacher_id);

-- ────────────────────────────────────────────────────────────
-- 3. STUDENTS
-- ────────────────────────────────────────────────────────────
create table public.students (
  id              uuid primary key default uuid_generate_v4(),
  class_id        uuid not null references public.classes(id) on delete cascade,
  student_name    text not null,
  student_number  text not null,
  access_code     text not null unique default substring(md5(random()::text) from 1 for 8),
  created_at      timestamptz default now()
);
alter table public.students enable row level security;
create policy "Öğretmen kendi öğrencilerini yönetir" on public.students
  for all using (
    exists (select 1 from public.classes
            where classes.id = students.class_id and classes.teacher_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────
-- 4. TESTS
-- settings JSON şeması:
-- { "layout": "deneme" | "yaprak" | "yazili",
--   "columns": 1|2|3,
--   "margins": { "top": 20, "bottom": 20, "left": 15, "right": 15 },
--   "scoring": { "wrong_penalty": 0.25 },
--   "timing":  { "duration_minutes": 40 },
--   "watermark": { "text": "Okul Adı", "image_url": null, "opacity": 0.15 },
--   "design_color": "#3B82F6",
--   "groups": ["A","B","C","D"]
-- }
-- ────────────────────────────────────────────────────────────
create table public.tests (
  id          uuid primary key default uuid_generate_v4(),
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  settings    jsonb not null default '{}',
  status      text not null check (status in ('draft','published','archived')) default 'draft',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.tests enable row level security;
create policy "Öğretmen kendi testlerini yönetir" on public.tests
  for all using (auth.uid() = teacher_id);
create policy "Yayınlı testleri herkes görür" on public.tests
  for select using (status = 'published');

-- ────────────────────────────────────────────────────────────
-- 5. QUESTIONS
-- metadata JSON şeması:
-- { "is_description": false,   -- paragraf başlığı mı?
--   "is_expanded": false,      -- iki sütuna yayılsın mı?
--   "points": 1,
--   "width_px": 400,
--   "height_px": 200,
--   "source_filename": "1A.png"  -- dosya adından otomatik cevap ata
-- }
-- ────────────────────────────────────────────────────────────
create table public.questions (
  id              uuid primary key default uuid_generate_v4(),
  test_id         uuid not null references public.tests(id) on delete cascade,
  image_url       text,
  question_text   text,
  correct_answer  text not null check (correct_answer in ('A','B','C','D','E')),
  order_index     int not null default 0,
  group_id        uuid,
  metadata        jsonb not null default '{}',
  created_at      timestamptz default now()
);
create index idx_questions_test_id  on public.questions(test_id);
create index idx_questions_group_id on public.questions(group_id);
alter table public.questions enable row level security;
create policy "Test sahibi soruları yönetir" on public.questions
  for all using (
    exists (select 1 from public.tests
            where tests.id = questions.test_id and tests.teacher_id = auth.uid())
  );
create policy "Yayınlı test sorularını herkes görür" on public.questions
  for select using (
    exists (select 1 from public.tests
            where tests.id = questions.test_id and tests.status = 'published')
  );

-- ────────────────────────────────────────────────────────────
-- 6. EXAMS
-- ────────────────────────────────────────────────────────────
create table public.exams (
  id          uuid primary key default uuid_generate_v4(),
  test_id     uuid not null references public.tests(id) on delete cascade,
  start_time  timestamptz not null,
  end_time    timestamptz not null,
  is_active   boolean not null default false,
  created_at  timestamptz default now()
);
alter table public.exams enable row level security;
create policy "Öğretmen sınavları yönetir" on public.exams
  for all using (
    exists (select 1 from public.tests
            where tests.id = exams.test_id and tests.teacher_id = auth.uid())
  );
create policy "Aktif sınavları herkes görür" on public.exams
  for select using (is_active = true);

-- ────────────────────────────────────────────────────────────
-- 7. SUBMISSIONS
-- answers JSON: { "1": "A", "2": "C", "3": "", ... }  (boş = işaretlenmemiş)
-- ────────────────────────────────────────────────────────────
create table public.submissions (
  id          uuid primary key default uuid_generate_v4(),
  exam_id     uuid not null references public.exams(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  answers     jsonb not null default '{}',
  score       numeric(5,2),
  correct     int default 0,
  wrong       int default 0,
  empty       int default 0,
  start_at    timestamptz default now(),
  finished_at timestamptz,
  unique (exam_id, student_id)
);
create index idx_submissions_exam_id on public.submissions(exam_id);
alter table public.submissions enable row level security;
create policy "Öğretmen submission'ları görür" on public.submissions
  for all using (
    exists (
      select 1 from public.exams
      join public.tests on tests.id = exams.test_id
      where exams.id = submissions.exam_id and tests.teacher_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 8. updated_at TRIGGER
-- ────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger tests_updated_at
  before update on public.tests
  for each row execute procedure public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 9. NET HESAPLAMA FONKSİYONU
-- ────────────────────────────────────────────────────────────
create or replace function public.calculate_score(
  p_submission_id uuid,
  p_penalty       numeric default 0.25
) returns numeric language plpgsql as $$
declare
  v_exam_id   uuid;
  v_test_id   uuid;
  v_answers   jsonb;
  v_correct   int := 0;
  v_wrong     int := 0;
  v_empty     int := 0;
  v_net       numeric;
  q           record;
  student_ans text;
begin
  select exam_id, answers into v_exam_id, v_answers
  from public.submissions where id = p_submission_id;

  select test_id into v_test_id from public.exams where id = v_exam_id;

  for q in
    select correct_answer, order_index
    from public.questions
    where test_id = v_test_id
    order by order_index
  loop
    student_ans := v_answers ->> q.order_index::text;
    if student_ans is null or student_ans = '' then
      v_empty := v_empty + 1;
    elsif student_ans = q.correct_answer then
      v_correct := v_correct + 1;
    else
      v_wrong := v_wrong + 1;
    end if;
  end loop;

  v_net := greatest(0, v_correct - (v_wrong * p_penalty));

  update public.submissions
  set score = v_net, correct = v_correct, wrong = v_wrong, empty = v_empty
  where id = p_submission_id;

  return v_net;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. STORAGE BUCKETS (Dashboard'dan yapılacak)
-- ────────────────────────────────────────────────────────────
-- Bucket: "questions"
--   public: false | max_file_size: 10485760 | allowed_mime: image/*, application/pdf
-- Bucket: "watermarks"
--   public: true  | max_file_size: 2097152  | allowed_mime: image/*
