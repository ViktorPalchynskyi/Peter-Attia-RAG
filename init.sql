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