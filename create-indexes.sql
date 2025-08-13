-- Create vector indexes for optimal search performance

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_document_chunks_embedding_ivfflat;

-- Create HNSW index for cosine distance (best for embeddings)
CREATE INDEX CONCURRENTLY idx_document_chunks_embedding_hnsw 
ON document_chunks USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat index (faster build, slower search)
-- CREATE INDEX CONCURRENTLY idx_document_chunks_embedding_ivfflat 
-- ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
-- WITH (lists = 100);

-- Create additional indexes for filtering
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);

-- Show created indexes
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks') 
ORDER BY tablename, indexname;