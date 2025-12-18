import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { WebScraperService } from './services/web-scraper.service';
import { TextChunkerService } from './services/text-chunker.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorDbService } from './services/vector-db.service';

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private readonly openaiClient: OpenAI;
  private readonly llamaModel: string = 'meta-llama/Llama-3.1-8B-Instruct:novita';
  private websiteUrl: string | null = null;
  private isInitialized: boolean = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly webScraperService: WebScraperService,
    private readonly textChunkerService: TextChunkerService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorDbService: VectorDbService,
  ) {
    const apiKey = this.configService.get<string>('HF_TOKEN');
    if (!apiKey) {
      throw new Error('HF_TOKEN is required');
    }
    this.openaiClient = new OpenAI({
      baseURL: 'https://router.huggingface.co/v1',
      apiKey: apiKey,
    });
  }

  /**
   * Auto-initialize RAG on module startup if RAG_WEBSITE_URL is set
   */
  async onModuleInit() {
    const websiteUrl = this.configService.get<string>('RAG_WEBSITE_URL');
    if (websiteUrl) {
      // Parse comma-separated URLs
      const urls = websiteUrl
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0);

      this.logger.log(
        `Auto-initializing RAG with ${urls.length} website URL(s) from environment: ${urls.join(', ')}`,
      );
      try {
        await this.initializeRag(urls);
        this.logger.log('RAG system auto-initialized successfully');
      } catch (error) {
        this.logger.error(
          'Failed to auto-initialize RAG system. You can initialize manually via the /rag/initialize endpoint.',
          error,
        );
        // Don't throw - allow the app to start even if RAG init fails
        // Users can still initialize manually via the endpoint
      }
    } else {
      this.logger.log(
        'RAG_WEBSITE_URL not set. RAG system will need to be initialized manually via /rag/initialize endpoint.',
      );
    }
  }

  /**
   * Initialize RAG system by scraping and indexing website(s)
   * Supports both single URL (string) or multiple URLs (array)
   */
  async initializeRag(websiteUrls: string | string[]): Promise<void> {
    try {
      // Normalize to array
      const urls = Array.isArray(websiteUrls) ? websiteUrls : [websiteUrls];

      this.logger.log(
        `Initializing RAG with ${urls.length} website(s): ${urls.join(', ')}`,
      );

      // Store first URL as primary (for backward compatibility)
      this.websiteUrl = urls[0];

      // 1. Scrape all websites
      const allContent: string[] = [];

      for (const url of urls) {
        this.logger.log(`Scraping website: ${url}`);
        try {
          const content = await this.webScraperService.scrapeWebsite(url);
          allContent.push(`\n\n=== Website: ${url} ===\n\n${content}`);
        } catch (error) {
          this.logger.warn(
            `Failed to scrape ${url}, continuing with other URLs: ${error.message}`,
          );
          // Continue with other URLs even if one fails
        }
      }

      if (allContent.length === 0) {
        throw new HttpException(
          'No content scraped from any website',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Combine all content
      const combinedContent = allContent.join('\n\n');

      // 2. Chunk the content
      const chunks = this.textChunkerService.chunkText(combinedContent);

      if (chunks.length === 0) {
        throw new HttpException(
          'No content chunks created from websites',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. Generate embeddings
      this.logger.log('Generating embeddings for chunks...');
      const texts = chunks.map((chunk) => chunk.text);
      const embeddings = await this.embeddingService.generateEmbeddings(texts);

      // 4. Store in vector database
      const documents = chunks.map((chunk, index) => {
        // Try to extract page/website URL from chunk text if it contains markers
        let sourceUrl = urls[0];
        if (
          chunk.text.includes('=== Page:') ||
          chunk.text.includes('=== Website:')
        ) {
          const pageMatch = chunk.text.match(
            /=== (?:Page|Website): (https?:\/\/[^\s]+) ===/,
          );
          if (pageMatch) {
            sourceUrl = pageMatch[1];
          }
        }

        return {
          id: `chunk_${index}_${Date.now()}`,
          text: chunk.text.replace(
            /=== (?:Page|Website): [^\n]+ ===\n\n/g,
            '',
          ), // Remove markers from text
          embedding: embeddings[index],
          metadata: {
            index: chunk.index,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
            source: sourceUrl,
            baseUrls: urls, // Store all base URLs
          },
        };
      });

      // Clear old data and add new
      await this.vectorDbService.clearCollection();
      await this.vectorDbService.addDocuments(documents);

      this.isInitialized = true;
      this.logger.log(
        `RAG system initialized with ${documents.length} chunks from ${urls.length} website(s)`,
      );
    } catch (error) {
      this.logger.error('Error initializing RAG:', error);
      throw new HttpException(
        `Failed to initialize RAG: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Query the RAG system
   */
  async query(query: string): Promise<{ answer: string }> {
    if (!query || !query.trim()) {
      throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
    }

    if (!this.isInitialized || !this.websiteUrl) {
      throw new HttpException(
        'RAG system not initialized. Please initialize with a website URL first via /rag/initialize endpoint or set RAG_WEBSITE_URL environment variable.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      this.logger.log(`Processing query: ${query.substring(0, 100)}...`);

      // 1. Generate query embedding
      const queryEmbedding =
        await this.embeddingService.generateEmbedding(query);

      // 2. Search for similar chunks
      const similarDocs = await this.vectorDbService.searchSimilar(
        queryEmbedding,
        5,
      );

      if (similarDocs.length === 0) {
        throw new HttpException(
          'No relevant content found for your query',
          HttpStatus.NOT_FOUND,
        );
      }

      // 3. Build context from retrieved chunks
      const context = similarDocs.map((doc) => doc.text).join('\n\n---\n\n');

      // 4. Generate answer using Llama from Hugging Face
      const prompt = `You are a helpful AI assistant. Answer the user's question based on the following context from a website. Only provide answer if you find something don't give any generic answer If the answer cannot be found in the context, say so.

Context:
${context}

Question: ${query}

Answer:`;

      const chatCompletion = await this.openaiClient.chat.completions.create({
        model: this.llamaModel,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const answer = chatCompletion.choices[0]?.message?.content || 'No answer generated';

      return { answer };
    } catch (error) {
      this.logger.error('Error processing RAG query:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `An error occurred while processing your query: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
