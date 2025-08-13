-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create database user if needed (optional, since we use default postgres user)
-- CREATE USER rag_user WITH PASSWORD 'secure_password';
-- GRANT ALL PRIVILEGES ON DATABASE rag_bot_db TO rag_user;

-- Show available extensions
SELECT name, default_version, installed_version 
FROM pg_available_extensions 
WHERE name = 'vector';

-- Test vector functionality
-- This will be removed once we create proper tables
CREATE TABLE IF NOT EXISTS test_vectors (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding VECTOR(1536)
);

-- Clean up test table
DROP TABLE IF EXISTS test_vectors;

-- Function to create vector indexes after tables are created
-- This will be run after Prisma migrations
CREATE OR REPLACE FUNCTION create_vector_indexes() 
RETURNS void AS $
BEGIN
    -- Create HNSW index for fast similarity search
    -- This will be executed after the table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_chunks') THEN
        -- Drop existing index if exists
        DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;
        
        -- Create HNSW index for cosine distance
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_chunks_embedding_hnsw 
        ON document_chunks USING hnsw (embedding vector_cosine_ops) 
        WITH (m = 16, ef_construction = 64);
        
        RAISE NOTICE 'Vector indexes created successfully';
    ELSE
        RAISE NOTICE 'Table document_chunks does not exist yet';
    END IF;
END;
$ LANGUAGE plpgsql;