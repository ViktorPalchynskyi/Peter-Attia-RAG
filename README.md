# 🤖 RAG Telegram Bot - Peter Attia Knowledge Base

AI-powered Telegram bot for health and longevity questions based on Peter Attia's research and content. Uses Retrieval-Augmented Generation (RAG) to provide accurate, context-aware answers from a comprehensive knowledge base.

## 🛠️ Technologies Stack

### **Backend Framework**
- **NestJS** `^11.0.1` - Progressive Node.js framework
- **TypeScript** `^5.7.3` - Type-safe JavaScript superset
- **Node.js** - JavaScript runtime environment

### **Database & Vector Search**
- **PostgreSQL** with **pgvector** extension - Vector database for semantic search
- **Prisma ORM** `^6.14.0` - Database access and management

### **AI & Machine Learning**
- **OpenAI API** `^5.12.2` - GPT models and text embeddings
  - `text-embedding-3-small` - Text embeddings generation
  - `gpt-4` / `gpt-3.5-turbo` - Response generation

### **Telegram Integration**
- **node-telegram-bot-api** `^0.66.0` - Telegram Bot API wrapper
- **Webhook architecture** - Real-time message processing

### **Document Processing**
- **pdf-parse** `^1.1.1` - PDF document parsing
- **mammoth** `^1.10.0` - DOCX/DOC document processing
- **xlsx** `^0.18.5` - Excel spreadsheet parsing
- **node-stream-zip** `^1.15.0` - ZIP archive extraction

### **External Integrations**
- **Dropbox API** `^10.34.0` - Knowledge base file storage and retrieval

### **Development & Deployment**
- **Docker & Docker Compose** - Containerization
- **Swagger/OpenAPI** `^11.2.0` - API documentation
- **ESLint** `^9.18.0` - Code linting
- **Prettier** `^3.4.2` - Code formatting
- **Jest** `^29.7.0` - Testing framework

### **Validation & Transformation**
- **class-validator** `^0.14.2` - Input validation
- **class-transformer** `^0.5.1` - Object transformation

## 🏗️ Project Architecture

### **Core Components**
1. **Document Processing Pipeline** - Ingests and processes documents from Dropbox
2. **Vector Search Engine** - Semantic similarity search using embeddings
3. **RAG Pipeline** - Combines search results with LLM generation
4. **Telegram Bot Interface** - User interaction layer
5. **REST API** - Administrative and debugging endpoints

### **Data Flow**
1. Documents stored in Dropbox → Downloaded and parsed
2. Text chunked into fragments → Converted to embeddings
3. Embeddings stored in PostgreSQL with pgvector
4. User questions → Embedded and searched against knowledge base
5. Relevant context + question → Sent to LLM for answer generation

## 🚀 Quick Start

### **Prerequisites**
- Docker & Docker Compose
- OpenAI API key
- Dropbox API credentials
- Telegram Bot Token

### **Setup**
```bash
# Clone repository
git clone <repository-url>
cd rag-telegram-bot

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start services
docker-compose up -d

# Initialize database
docker exec rag-telegram-bot-dev npx prisma db push

# Process documents
curl -X POST "http://localhost:3000/documents/process-all"

# Generate embeddings
curl -X POST "http://localhost:3000/documents/embeddings/generate-all"

# Setup Telegram webhook (see Webhook Setup section below)
```

## 🔗 Webhook Setup

### **Step 1: Expose your local server (Development)**

**Using ngrok (Recommended):**
```bash
# Install ngrok
npm install -g ngrok

# Expose local port 3000
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

**Alternative: Using localtunnel:**
```bash
# Install localtunnel
npm install -g localtunnel

# Expose local port 3000
lt --port 3000

# Copy the HTTPS URL
```

### **Step 2: Set webhook URL in Telegram**

**Method 1: Using curl (Recommended):**
```bash
# Replace YOUR_BOT_TOKEN and YOUR_NGROK_URL
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://<YOUR_NGROK_URL>/telegram/webhook"}'

# Example:
curl -X POST "https://api.telegram.org/bot1234567890:ABC.../setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://abc123.ngrok.io/telegram/webhook"}'
```

**Method 2: Using browser:**
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_NGROK_URL>/telegram/webhook
```

### **Step 3: Verify webhook setup**

```bash
# Check webhook status
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"

# Test bot health
curl "http://localhost:3000/health"

# Test Telegram endpoint
curl "http://localhost:3000/telegram/info"
```

### **Step 4: Test the bot**

1. Open your bot in Telegram (@your_bot_name)
2. Send `/start` command
3. Ask a health-related question
4. Check logs: `docker logs rag-telegram-bot-dev --tail 20`

### **Webhook Troubleshooting**

**Common issues:**

1. **HTTPS required**: Telegram webhooks require HTTPS URLs
   ```bash
   # ❌ Wrong: http://localhost:3000/telegram/webhook
   # ✅ Correct: https://abc123.ngrok.io/telegram/webhook
   ```

2. **Port not accessible**: Ensure your app is running on correct port
   ```bash
   curl "http://localhost:3000/health"  # Should return 200 OK
   ```

3. **Webhook not set**: Verify webhook URL is registered
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```

4. **Bot token invalid**: Check your TELEGRAM_BOT_TOKEN in .env
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getMe"  # Should return bot info
   ```

### **Production Deployment**

For production, replace ngrok URL with your actual domain:

```bash
# Production webhook setup
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://yourdomain.com/telegram/webhook"}'
```

### **API Endpoints**
- `GET /health` - Health check
- `POST /documents/process-all` - Process all Dropbox documents
- `POST /documents/embeddings/generate-all` - Generate embeddings
- `POST /documents/search` - Semantic search
- `POST /documents/rag` - RAG query
- `GET /dropbox/status` - Dropbox connection status

## 🔧 Configuration

### **Environment Variables**
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/rag_db"

# OpenAI
OPENAI_API_KEY="sk-..."

# Dropbox
DROPBOX_ACCESS_TOKEN="sl...."

# Telegram
TELEGRAM_BOT_TOKEN="1234567890:ABC..."
TELEGRAM_WEBHOOK_URL="https://your-domain.com/telegram/webhook"

# Application
PORT=3000
NODE_ENV=development
```

## 📊 Features

### **Multi-language Support**
- 🇷🇺 Russian (Russia, Ukraine, Belarus, Kazakhstan)
- 🇺🇸 English (all other regions)
- Auto-detection based on Telegram user locale

### **Response Modes**
- **Quick** (`/quick`) - Brief, concise answers
- **Detailed** (`/detailed`) - Comprehensive explanations
- **Auto** - Intelligent mode selection

### **Document Types Supported**
- PDF documents
- Word documents (DOCX, DOC)
- Excel spreadsheets (XLSX, XLS)
- Text files (TXT)
- ZIP archives

### **Advanced Features**
- Semantic search with similarity scoring
- Context-aware quote extraction
- Source attribution and referencing
- Usage analytics and statistics
- Confidence scoring for answers

## 📈 Performance Metrics

### **Current Knowledge Base**
- **134 documents** successfully processed
- **46,678 text chunks** with embeddings
- **~2.5M words** of content
- **Processing time**: ~72 minutes for full embedding generation

### **Response Performance**
- **Average response time**: 4-8 seconds
- **Search accuracy**: High relevance with similarity threshold 0.7
- **Confidence scores**: Typically 75-85% for well-covered topics