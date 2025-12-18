import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface Document {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

@Injectable()
export class VectorDbService implements OnModuleInit {
  private readonly logger = new Logger(VectorDbService.name);
  private documents: Document[] = [];
  private readonly collectionName = 'rag_documents';

  async onModuleInit() {
    this.logger.log(
      `Initialized in-memory vector database collection: ${this.collectionName}`,
    );
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
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

  async addDocuments(documents: Document[]): Promise<void> {
    try {
      this.documents.push(...documents);
      this.logger.log(
        `Added ${documents.length} documents to in-memory vector database. Total: ${this.documents.length}`,
      );
    } catch (error) {
      this.logger.error('Error adding documents to vector DB:', error);
      throw error;
    }
  }

  async searchSimilar(
    queryEmbedding: number[],
    topK: number = 5,
  ): Promise<Document[]> {
    try {
      if (this.documents.length === 0) {
        this.logger.warn('No documents in vector database');
        return [];
      }

      // Calculate similarity for all documents
      const similarities = this.documents.map((doc) => ({
        document: doc,
        similarity: this.cosineSimilarity(queryEmbedding, doc.embedding),
      }));

      // Sort by similarity (highest first) and take top K
      const topDocuments = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK)
        .map((item) => item.document);

      this.logger.debug(
        `Found ${topDocuments.length} similar documents (top similarity: ${similarities[0]?.similarity.toFixed(4)})`,
      );

      return topDocuments;
    } catch (error) {
      this.logger.error('Error searching vector DB:', error);
      throw error;
    }
  }

  async clearCollection(): Promise<void> {
    try {
      const previousCount = this.documents.length;
      this.documents = [];
      this.logger.log(
        `Cleared in-memory vector database collection (removed ${previousCount} documents)`,
      );
    } catch (error) {
      this.logger.error('Error clearing collection:', error);
      throw error;
    }
  }

  async getCollectionCount(): Promise<number> {
    return this.documents.length;
  }
}
