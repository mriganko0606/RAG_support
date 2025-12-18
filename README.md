# RAG Support Chat Server

A standalone Node.js server that replicates all functionality from the NestJS RAG service, with a simple web frontend.

## Features

- **Website Scraping**: Automatically crawls and scrapes website content
- **Text Chunking**: Splits content into manageable chunks with overlap
- **Embeddings**: Uses Google Gemini for generating embeddings
- **Vector Search**: In-memory vector database with cosine similarity search
- **LLM Integration**: Uses Hugging Face router with Llama 3.1 8B model for answering questions
- **Simple Frontend**: Clean, modern web interface for asking questions

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Fill in your API keys and website URL(s) in `.env`:
- `HF_TOKEN`: Your Hugging Face token
- `GEMINI_API_KEY`: Your Google Gemini API key
- `RAG_WEBSITE_URL`: Website URL(s) to initialize (comma-separated for multiple URLs, e.g., `https://example.com, https://example2.com`)

4. Start the server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

## Usage

1. Set `RAG_WEBSITE_URL` in your `.env` file with the website URL(s) you want to scrape
2. Start the server - it will automatically initialize the RAG system on startup
3. Open your browser to `http://localhost:3000`
4. Start asking questions about the website content!

## API Endpoints

### POST `/rag/initialize`
Manually initialize the RAG system with website URL(s). Note: This is optional if `RAG_WEBSITE_URL` is set in `.env` (auto-initialization happens on startup).

**Request Body:**
```json
{
  "url": "https://example.com"
}
```
or
```json
{
  "urls": ["https://example.com", "https://example2.com"]
}
```

**Response:**
```json
{
  "message": "RAG system initialized successfully",
  "chunksCount": 150,
  "websitesCount": 1
}
```

### POST `/rag/query`
Query the RAG system with a question.

**Request Body:**
```json
{
  "query": "What is the main feature of this product?"
}
```

**Response:**
```json
{
  "answer": "The main feature is..."
}
```

### GET `/health`
Check server health and initialization status.

**Response:**
```json
{
  "status": "ok",
  "initialized": true,
  "documentsCount": 150
}
```

## Architecture

The server includes all functionality from the original NestJS service:

- **Web Scraping**: Crawls websites, extracts content, follows links (up to 50 pages)
- **Text Chunking**: Splits text into 1000-character chunks with 200-character overlap
- **Embeddings**: Uses Gemini's text-embedding-004 model
- **Vector DB**: In-memory storage with cosine similarity search
- **LLM**: Uses Hugging Face router with Llama 3.1 8B Instruct model

## Deployment

### Deploy to Render (Recommended)

1. Push your code to GitHub (already done!)
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository: `https://github.com/mriganko0606/RAG_support.git`
5. Configure:
   - **Name**: `rag-support-chat` (or any name you prefer)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose a paid plan)
6. Add Environment Variables:
   - `HF_TOKEN`: Your Hugging Face token
   - `GEMINI_API_KEY`: Your Google Gemini API key
   - `RAG_WEBSITE_URL`: Your website URLs (comma-separated)
   - `PORT`: `10000` (Render uses port 10000, but server.js will auto-detect)
7. Click "Create Web Service"
8. Wait for deployment (first initialization may take 5-10 minutes)

**Note**: Render will automatically detect `render.yaml` if present, making setup even easier!

### Deploy to Vercel

⚠️ **Warning**: Vercel uses serverless functions, which won't work well with this codebase as-is. The current implementation uses in-memory storage and long-running initialization processes that aren't suitable for serverless.

For Vercel deployment, you would need to:
- Restructure code into serverless functions
- Use persistent storage (Vercel KV, database, etc.)
- Handle initialization differently

**Recommendation**: Use Render for this project.

## Notes

- The vector database is in-memory, so data is lost on server restart (but auto-reinitializes)
- Website scraping respects rate limits with 500ms delays between pages
- Maximum 50 pages scraped per website to prevent infinite loops
- Embeddings are generated in batches of 10 to avoid rate limits
- First deployment/initialization may take several minutes depending on the number of URLs
