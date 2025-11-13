
import { createClient } from '@supabase/supabase-js';

// Since this is a client-side application without a build process to handle environment variables,
// we define the Supabase credentials directly. These are public keys and are safe to expose in the browser.
const supabaseUrl = 'https://urfbdhbnkcjffodzbrdn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZmJkaGJua2NqZmZvZHpicmRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMDUxMTMsImV4cCI6MjA3ODU4MTExM30.Kp1QPvXIUwScV4DnQNCZoqSnkmQwMozR6RC2OEj5k4g';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key are not set in supabaseClient.ts. Please add them.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
