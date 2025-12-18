import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { WebScraperService } from './services/web-scraper.service';
import { TextChunkerService } from './services/text-chunker.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorDbService } from './services/vector-db.service';

@Module({
  controllers: [RagController],
  providers: [
    RagService,
    WebScraperService,
    TextChunkerService,
    EmbeddingService,
    VectorDbService,
  ],
  exports: [RagService],
})
export class ChatSupportModule {}

