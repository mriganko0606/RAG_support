import { Controller, Post, Body } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagQueryDto } from './dto/rag-query.dto';
import { InitializeRagDto } from './dto/initialize-rag.dto';
import { ZodValidationPipe } from 'nestjs-zod';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('rag')
@ApiTags('RAG Support Chat')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('initialize')
  @ApiOperation({
    summary: 'Initialize RAG system with website URL(s) (Optional)',
    description:
      'Scrapes the website(s), chunks the content, generates embeddings, and stores them in the vector database. Supports both single URL or multiple URLs. Note: If RAG_WEBSITE_URL is set in environment variables (comma-separated for multiple), the system will auto-initialize on startup. This endpoint is useful for manual re-initialization or changing the website URL(s).',
  })
  @ApiResponse({
    status: 200,
    description: 'RAG system initialized successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'RAG system initialized successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL or failed to scrape website',
  })
  async initialize(
    @Body(new ZodValidationPipe(InitializeRagDto)) initializeDto: InitializeRagDto,
  ) {
    // Support both single URL and array of URLs
    const urls = initializeDto.urls || (initializeDto.url ? [initializeDto.url] : []);
    await this.ragService.initializeRag(urls);
    return { message: 'RAG system initialized successfully' };
  }

  @Post('query')
  @ApiOperation({
    summary: 'Query RAG API for support chat',
    description:
      'Sends a user query to the RAG system, retrieves relevant context, and generates an answer using Gemini',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved answer from RAG API',
    schema: {
      type: 'object',
      properties: {
        answer: {
          type: 'string',
          description: 'The answer from RAG API',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query provided or RAG system not initialized',
  })
  @ApiResponse({
    status: 404,
    description: 'No relevant content found for the query',
  })
  @ApiResponse({
    status: 503,
    description: 'RAG API service unavailable',
  })
  async query(
    @Body(new ZodValidationPipe(RagQueryDto)) ragQueryDto: RagQueryDto,
  ) {
    return this.ragService.query(ragQueryDto.query);
  }
}

