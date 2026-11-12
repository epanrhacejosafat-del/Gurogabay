-- Run in Supabase > SQL Editor. Change "quizzes" if your table has another name.

alter table quizzes
  add column if not exists items int not null default 50 check (items between 1 and 100),
  add column if not exists choice_type text not null default 'AD'
    check (choice_type in ('AB','AC','AD','AE','TF')),
  add column if not exists header jsonb;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  class_name text not null,
  student_id text,
  name text not null
);

alter table students enable row level security;

create policy "own students" on students
  for all using (user_id = auth.uid());
