import { Injectable, Logger } from '@nestjs/common';

export interface TextChunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

@Injectable()
export class TextChunkerService {
  private readonly logger = new Logger(TextChunkerService.name);
  private readonly chunkSize: number = 1000; // characters
  private readonly chunkOverlap: number = 200; // characters

  chunkText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    let startChar = 0;
    let index = 0;

    while (startChar < text.length) {
      const endChar = Math.min(startChar + this.chunkSize, text.length);
      const chunkText = text.slice(startChar, endChar);

      // Try to break at sentence boundaries
      const adjustedEnd = this.findSentenceBoundary(text, startChar, endChar);

      chunks.push({
        text: text.slice(startChar, adjustedEnd),
        index,
        startChar,
        endChar: adjustedEnd,
      });

      // Move start position with overlap
      startChar = Math.max(
        adjustedEnd - this.chunkOverlap,
        startChar + this.chunkSize,
      );
      index++;
    }

    this.logger.log(`Created ${chunks.length} chunks from text`);
    return chunks;
  }

  private findSentenceBoundary(
    text: string,
    start: number,
    end: number,
  ): number {
    // Look for sentence endings in the last 200 characters
    const searchStart = Math.max(start, end - 200);
    const searchText = text.slice(searchStart, end);

    // Find last sentence boundary
    const sentenceEnd = /[.!?]\s+/.exec(searchText);
    if (sentenceEnd) {
      return searchStart + sentenceEnd.index + sentenceEnd[0].length;
    }

    // Fallback to paragraph break
    const paragraphEnd = /\n\n/.exec(searchText);
    if (paragraphEnd) {
      return searchStart + paragraphEnd.index + paragraphEnd[0].length;
    }

    return end;
  }
}

