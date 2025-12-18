const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const TurndownService = require('turndown');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configuration
const HF_TOKEN = process.env.HF_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RAG_WEBSITE_URL = process.env.RAG_WEBSITE_URL;
const PORT = process.env.PORT || 3000;
const LLAMA_MODEL = 'meta-llama/Llama-3.1-8B-Instruct:novita';
const EMBEDDING_MODEL = 'models/text-embedding-004';

// Initialize clients
if (!HF_TOKEN) {
  throw new Error('HF_TOKEN is required in environment variables');
}
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required in environment variables');
}
if (!RAG_WEBSITE_URL) {
  throw new Error('RAG_WEBSITE_URL is required in environment variables. Set it in your .env file (comma-separated for multiple URLs)');
}

const openaiClient = new OpenAI({
  baseURL: 'https://router.huggingface.co/v1',
  apiKey: HF_TOKEN,
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const turndownService = new TurndownService();

// State
let websiteUrl = null;
let isInitialized = false;
let documents = [];

// ==================== Helper Functions ====================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Clean text
 */
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Find sentence boundary for chunking
 */
function findSentenceBoundary(text, start, end) {
  const searchStart = Math.max(start, end - 200);
  const searchText = text.slice(searchStart, end);

  const sentenceEnd = /[.!?]\s+/.exec(searchText);
  if (sentenceEnd) {
    return searchStart + sentenceEnd.index + sentenceEnd[0].length;
  }

  const paragraphEnd = /\n\n/.exec(searchText);
  if (paragraphEnd) {
    return searchStart + paragraphEnd.index + paragraphEnd[0].length;
  }

  return end;
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text) {
  const chunks = [];
  const chunkSize = 1000;
  const chunkOverlap = 200;
  let startChar = 0;
  let index = 0;

  while (startChar < text.length) {
    const endChar = Math.min(startChar + chunkSize, text.length);
    const adjustedEnd = findSentenceBoundary(text, startChar, endChar);

    chunks.push({
      text: text.slice(startChar, adjustedEnd),
      index,
      startChar,
      endChar: adjustedEnd,
    });

    startChar = Math.max(
      adjustedEnd - chunkOverlap,
      startChar + chunkSize,
    );
    index++;
  }

  return chunks;
}

/**
 * Scrape a single page
 */
async function scrapeSinglePage(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const $ = cheerio.load(response.data);
  $('script, style, nav, footer, header, aside').remove();

  const mainContent = $('main, article, .content, #content, body').first();

  if (!mainContent.length) {
    return '';
  }

  const markdown = turndownService.turndown(mainContent.html() || '');
  return cleanText(markdown);
}

/**
 * Extract links from a page
 */
async function extractLinks(url) {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(response.data);
    const links = [];
    const baseUrlObj = new URL(url);
    const currentPath = baseUrlObj.pathname;

    $('nav, footer, header, aside, .nav, .navigation, .footer, .header, .sidebar, .menu').remove();

    const mainContent = $('main, article, .content, #content, .documentation, .docs-content, body');

    mainContent.find('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, url).href;
        const urlObj = new URL(absoluteUrl);

        if (urlObj.origin === baseUrlObj.origin) {
          const linkPath = urlObj.pathname;

          const excludedPaths = [
            '/api/',
            '/contact',
            '/about',
            '/privacy',
            '/terms',
            '/legal',
            '/blog',
            '/news',
            '/social',
            '/facebook',
            '/twitter',
            '/instagram',
            '/linkedin',
            '/youtube',
          ];

          const isExcluded =
            excludedPaths.some((path) => linkPath.includes(path)) ||
            linkPath.match(/\.(pdf|jpg|jpeg|png|gif|svg|zip|doc|docx)$/i) ||
            linkPath.includes('#') ||
            urlObj.search ||
            linkPath.length <= 1;

          if (isExcluded) {
            return;
          }

          const isFromRoot = currentPath === '/' || currentPath === '';
          const isChildPath =
            linkPath.startsWith(currentPath) && linkPath !== currentPath;

          if (isFromRoot || isChildPath) {
            const currentDepth = currentPath.split('/').filter((p) => p).length;
            const linkDepth = linkPath.split('/').filter((p) => p).length;

            if (linkDepth >= currentDepth) {
              links.push(absoluteUrl);
            }
          }
        }
      } catch (error) {
        // Invalid URL, skip
      }
    });

    return [...new Set(links)];
  } catch (error) {
    console.warn(`Error extracting links from ${url}:`, error.message);
    return [];
  }
}

/**
 * Scrape website with automatic link crawling
 */
async function scrapeWebsite(baseUrl) {
  const baseUrlOrigin = new URL(baseUrl).origin;
  const visitedUrls = new Set();
  const allContent = [];
  const urlsToVisit = [baseUrl];
  const maxPages = 50;

  console.log(`Starting automatic crawling from base URL: ${baseUrl}`);

  while (urlsToVisit.length > 0 && visitedUrls.size < maxPages) {
    const currentUrl = urlsToVisit.shift();

    if (visitedUrls.has(currentUrl)) {
      continue;
    }

    try {
      console.log(`Scraping page ${visitedUrls.size + 1}/${maxPages}: ${currentUrl}`);

      const pageContent = await scrapeSinglePage(currentUrl);

      if (pageContent.trim().length > 0) {
        allContent.push(`\n\n=== Page: ${currentUrl} ===\n\n${pageContent}`);
      }

      const links = await extractLinks(currentUrl);

      for (const link of links) {
        if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
          urlsToVisit.push(link);
        }
      }

      visitedUrls.add(currentUrl);

      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.warn(`Failed to scrape ${currentUrl}: ${error.message}`);
    }
  }

  const combinedContent = allContent.join('\n\n');
  console.log(`Scraped ${visitedUrls.size} pages, total ${combinedContent.length} characters`);

  if (combinedContent.trim().length === 0) {
    throw new Error('No content found on any pages');
  }

  return combinedContent;
}

/**
 * Generate embedding using Gemini
 */
async function generateEmbedding(text) {
  try {
    const model = genAI.getGenerativeModel({
      model: EMBEDDING_MODEL,
    });

    const result = await model.embedContent(text);

    const embedding =
      result.embedding?.values ||
      (result.embedding && result.embedding.embedding) ||
      result.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Gemini');
    }

    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Generate embeddings for multiple texts
 */
async function generateEmbeddings(texts) {
  const batchSize = 10;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(
      batch.map((text) => generateEmbedding(text))
    );
    embeddings.push(...batchEmbeddings);

    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return embeddings;
}

/**
 * Search for similar documents
 */
function searchSimilar(queryEmbedding, topK = 5) {
  if (documents.length === 0) {
    console.warn('No documents in vector database');
    return [];
  }

  const similarities = documents.map((doc) => ({
    document: doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding),
  }));

  const topDocuments = similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map((item) => item.document);

  return topDocuments;
}

// ==================== API Endpoints ====================

/**
 * Initialize RAG system (re-initializes using RAG_WEBSITE_URL from .env)
 */
app.post('/rag/initialize', async (req, res) => {
  try {
    if (!RAG_WEBSITE_URL) {
      return res.status(400).json({
        error: 'RAG_WEBSITE_URL is not set in environment variables. Please set it in your .env file.',
      });
    }

    const urls = RAG_WEBSITE_URL
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    console.log(`Re-initializing RAG with ${urls.length} website(s) from .env: ${urls.join(', ')}`);

    websiteUrl = urls[0];

    const allContent = [];

    for (const url of urls) {
      console.log(`Scraping website: ${url}`);
      try {
        const content = await scrapeWebsite(url);
        allContent.push(`\n\n=== Website: ${url} ===\n\n${content}`);
      } catch (error) {
        console.warn(`Failed to scrape ${url}, continuing with other URLs: ${error.message}`);
      }
    }

    if (allContent.length === 0) {
      return res.status(400).json({
        error: 'No content scraped from any website',
      });
    }

    const combinedContent = allContent.join('\n\n');
    const chunks = chunkText(combinedContent);

    if (chunks.length === 0) {
      return res.status(400).json({
        error: 'No content chunks created from websites',
      });
    }

    console.log('Generating embeddings for chunks...');
    const texts = chunks.map((chunk) => chunk.text);
    const embeddings = await generateEmbeddings(texts);

    const newDocuments = chunks.map((chunk, index) => {
      let sourceUrl = urls[0];
      if (
        chunk.text.includes('=== Page:') ||
        chunk.text.includes('=== Website:')
      ) {
        const pageMatch = chunk.text.match(
          /=== (?:Page|Website): (https?:\/\/[^\s]+) ===/
        );
        if (pageMatch) {
          sourceUrl = pageMatch[1];
        }
      }

      return {
        id: `chunk_${index}_${Date.now()}`,
        text: chunk.text.replace(
          /=== (?:Page|Website): [^\n]+ ===\n\n/g,
          ''
        ),
        embedding: embeddings[index],
        metadata: {
          index: chunk.index,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          source: sourceUrl,
          baseUrls: urls,
        },
      };
    });

    documents = [];
    documents.push(...newDocuments);
    isInitialized = true;

    console.log(
      `RAG system initialized with ${newDocuments.length} chunks from ${urls.length} website(s)`
    );

    res.json({
      message: 'RAG system initialized successfully',
      chunksCount: newDocuments.length,
      websitesCount: urls.length,
    });
  } catch (error) {
    console.error('Error initializing RAG:', error);
    res.status(500).json({
      error: `Failed to initialize RAG: ${error.message}`,
    });
  }
});

/**
 * Query RAG system
 */
app.post('/rag/query', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({
        error: 'Query is required',
      });
    }

    if (!isInitialized || !websiteUrl) {
      return res.status(400).json({
        error: 'RAG system not initialized. Please set RAG_WEBSITE_URL in your .env file and restart the server.',
      });
    }

    console.log(`Processing query: ${query.substring(0, 100)}...`);

    const queryEmbedding = await generateEmbedding(query);
    const similarDocs = searchSimilar(queryEmbedding, 5);

    if (similarDocs.length === 0) {
      return res.status(404).json({
        error: 'No relevant content found for your query',
      });
    }

    const context = similarDocs.map((doc) => doc.text).join('\n\n---\n\n');

    const prompt = `You are a helpful AI assistant. Answer the user's question based on the following context from a website. Only provide answer if you find something don't give any generic answer If the answer cannot be found in the context, say so.

Context:
${context}

Question: ${query}

Answer:`;

    const chatCompletion = await openaiClient.chat.completions.create({
      model: LLAMA_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const answer = chatCompletion.choices[0]?.message?.content || 'No answer generated';

    res.json({ answer });
  } catch (error) {
    console.error('Error processing RAG query:', error);
    res.status(500).json({
      error: `An error occurred while processing your query: ${error.message}`,
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    initialized: isInitialized,
    documentsCount: documents.length,
  });
});

// Auto-initialize on startup if RAG_WEBSITE_URL is set
async function autoInitialize() {
  if (RAG_WEBSITE_URL) {
    const urls = RAG_WEBSITE_URL
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    console.log(
      `Auto-initializing RAG with ${urls.length} website URL(s) from environment: ${urls.join(', ')}`
    );

    try {
      // Simulate POST request to initialize
      const allContent = [];
      websiteUrl = urls[0];

      for (const url of urls) {
        console.log(`Scraping website: ${url}`);
        try {
          const content = await scrapeWebsite(url);
          allContent.push(`\n\n=== Website: ${url} ===\n\n${content}`);
        } catch (error) {
          console.warn(`Failed to scrape ${url}, continuing with other URLs: ${error.message}`);
        }
      }

      if (allContent.length === 0) {
        throw new Error('No content scraped from any website');
      }

      const combinedContent = allContent.join('\n\n');
      const chunks = chunkText(combinedContent);

      if (chunks.length === 0) {
        throw new Error('No content chunks created from websites');
      }

      console.log('Generating embeddings for chunks...');
      const texts = chunks.map((chunk) => chunk.text);
      const embeddings = await generateEmbeddings(texts);

      const newDocuments = chunks.map((chunk, index) => {
        let sourceUrl = urls[0];
        if (
          chunk.text.includes('=== Page:') ||
          chunk.text.includes('=== Website:')
        ) {
          const pageMatch = chunk.text.match(
            /=== (?:Page|Website): (https?:\/\/[^\s]+) ===/
          );
          if (pageMatch) {
            sourceUrl = pageMatch[1];
          }
        }

        return {
          id: `chunk_${index}_${Date.now()}`,
          text: chunk.text.replace(
            /=== (?:Page|Website): [^\n]+ ===\n\n/g,
            ''
          ),
          embedding: embeddings[index],
          metadata: {
            index: chunk.index,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
            source: sourceUrl,
            baseUrls: urls,
          },
        };
      });

      documents = [];
      documents.push(...newDocuments);
      isInitialized = true;

      console.log(
        `RAG system auto-initialized with ${newDocuments.length} chunks from ${urls.length} website(s)`
      );
    } catch (error) {
      console.error(
        'Failed to auto-initialize RAG system. You can initialize manually via the /rag/initialize endpoint.',
        error
      );
    }
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await autoInitialize();
});

