-- DayFlow Database Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  category TEXT DEFAULT 'Other',
  completed BOOLEAN DEFAULT FALSE,
  section TEXT NOT NULL DEFAULT 'todo' CHECK (section IN ('todo', 'owe_me')),
  -- Date/time/reminder fields
  due_date TIMESTAMPTZ,
  due_time TEXT,
  reminder_enabled BOOLEAN DEFAULT FALSE,
  -- OWE ME fields
  owe_person TEXT,
  owe_description TEXT,
  -- AI fields
  ai_steps TEXT[],
  ai_summary TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(user_id, section);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(user_id, priority);

-- Enable Row Level Security
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only access their own tasks
CREATE POLICY "Users can view their own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Optional: allow anonymous/unauthenticated usage for development
-- Uncomment these if you want to test without auth:
-- CREATE POLICY "Allow anonymous read" ON tasks FOR SELECT USING (true);
-- CREATE POLICY "Allow anonymous insert" ON tasks FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Allow anonymous update" ON tasks FOR UPDATE USING (true);
-- CREATE POLICY "Allow anonymous delete" ON tasks FOR DELETE USING (true);
