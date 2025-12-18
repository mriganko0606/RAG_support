import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly embeddingModel: string = 'models/text-embedding-004'; // Gemini embedding model

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Use the embedding model directly
      const model = this.genAI.getGenerativeModel({
        model: this.embeddingModel,
      });

      // Generate embedding using embedContent
      const result = await model.embedContent(text);

      // Extract embedding vector
      // The response structure may vary, so we handle multiple possible formats
      const embedding =
        result.embedding?.values ||
        (result.embedding as any)?.embedding ||
        (result.embedding as any);

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from Gemini');
      }

      return embedding;
    } catch (error) {
      this.logger.error('Error generating embedding:', error);
      throw new HttpException(
        `Failed to generate embedding: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Generate embeddings in batches to avoid rate limits
    const batchSize = 10;
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map((text) => this.generateEmbedding(text)),
      );
      embeddings.push(...batchEmbeddings);

      // Small delay to avoid rate limiting
      if (i + batchSize < texts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return embeddings;
  }
}

