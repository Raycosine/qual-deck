-- Migration 3: Add source_library_id to problems for per-library cascade delete.
ALTER TABLE problems ADD COLUMN source_library_id INTEGER;
