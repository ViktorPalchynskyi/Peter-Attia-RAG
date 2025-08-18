-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY DEFAULT ('c' || encode(gen_random_bytes(12), 'base64')),
    filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    dropbox_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create document_chunks table  
CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY DEFAULT ('c' || encode(gen_random_bytes(12), 'base64')),
    document_id TEXT NOT NULL,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_position INTEGER DEFAULT 0,
    end_position INTEGER DEFAULT 0,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Create search_logs table
CREATE TABLE IF NOT EXISTS search_logs (
    id TEXT PRIMARY KEY DEFAULT ('c' || encode(gen_random_bytes(12), 'base64')),
    user_id VARCHAR(100),
    query TEXT NOT NULL,
    results JSONB,
    response_time FLOAT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);

-- Show created tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
