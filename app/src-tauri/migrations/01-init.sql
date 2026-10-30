-- Create source_libraries table
CREATE TABLE IF NOT EXISTS source_libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    json_path TEXT,
    pdfs_path TEXT,
    taxonomies_path TEXT,
    schemas_path TEXT,
    last_scanned_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create courses table
CREATE TABLE IF NOT EXISTS courses (
    course_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    tracking_enabled BOOLEAN DEFAULT 1,
    reminder_enabled BOOLEAN DEFAULT 1,
    color_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
    exam_id TEXT PRIMARY KEY,
    source_library_id INTEGER,
    year INTEGER,
    semester TEXT,
    source_filename TEXT,
    metadata_needs_review BOOLEAN DEFAULT 0,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_library_id) REFERENCES source_libraries(id)
);

-- Create problems table
CREATE TABLE IF NOT EXISTS problems (
    pid TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    problem_number INTEGER,
    secondary_course_id TEXT,
    course_confidence REAL,
    topic_confidence REAL,
    problem_statement TEXT,
    evidence TEXT,
    needs_review BOOLEAN DEFAULT 0,
    review_reason TEXT,
    additional_topic_suggestion TEXT,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(exam_id),
    FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- Create topic_nodes table
CREATE TABLE IF NOT EXISTS topic_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    parent_id INTEGER,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (course_id) REFERENCES courses(course_id),
    FOREIGN KEY (parent_id) REFERENCES topic_nodes(id)
);

-- Create problem_topics table
CREATE TABLE IF NOT EXISTS problem_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    course_id TEXT NOT NULL,
    topic_node_id INTEGER,
    topic_name TEXT NOT NULL,
    topic_kind TEXT, -- 'confirmed' or 'possible'
    FOREIGN KEY (pid) REFERENCES problems(pid),
    FOREIGN KEY (course_id) REFERENCES courses(course_id),
    FOREIGN KEY (topic_node_id) REFERENCES topic_nodes(id)
);

-- Create pdf_files table
CREATE TABLE IF NOT EXISTS pdf_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_library_id INTEGER NOT NULL,
    exam_id TEXT,
    course_id TEXT,
    kind TEXT, -- 'question' or 'solution'
    source_filename TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    label TEXT,
    is_primary BOOLEAN DEFAULT 0,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_library_id) REFERENCES source_libraries(id)
);

-- Create problem_pdf_links table
CREATE TABLE IF NOT EXISTS problem_pdf_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    pdf_file_id INTEGER NOT NULL,
    page_start INTEGER,
    page_end INTEGER,
    link_kind TEXT,
    FOREIGN KEY (pid) REFERENCES problems(pid),
    FOREIGN KEY (pdf_file_id) REFERENCES pdf_files(id)
);

-- Create attempts table
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    course_id TEXT NOT NULL,
    started_at DATETIME,
    ended_at DATETIME,
    duration_seconds INTEGER,
    attempt_mode TEXT,
    outcome TEXT,
    mastery INTEGER,
    path_quality TEXT,
    used_solution BOOLEAN,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pid) REFERENCES problems(pid),
    FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- Create problem_state table
CREATE TABLE IF NOT EXISTS problem_state (
    pid TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    current_mastery INTEGER DEFAULT 0,
    stability REAL DEFAULT 0,
    last_attempt_at DATETIME,
    next_review_at DATETIME,
    total_attempts INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    last_outcome TEXT,
    last_attempt_mode TEXT,
    manually_scheduled BOOLEAN DEFAULT 0,
    FOREIGN KEY (pid) REFERENCES problems(pid),
    FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
