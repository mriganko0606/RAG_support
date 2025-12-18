import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TurndownService = require('turndown');

@Injectable()
export class WebScraperService {
  private readonly logger = new Logger(WebScraperService.name);
  private readonly turndownService: any;
  private readonly maxPages: number = 50; // Limit to prevent infinite loops
  private visitedUrls = new Set<string>();
  private baseUrl: string = '';

  constructor() {
    this.turndownService = new TurndownService();
  }

  /**
   * Scrape website with automatic link crawling
   * Discovers and scrapes all pages from the same domain
   */
  async scrapeWebsite(baseUrl: string): Promise<string> {
    try {
      this.baseUrl = new URL(baseUrl).origin;
      this.visitedUrls.clear();

      const allContent: string[] = [];
      const urlsToVisit = [baseUrl];

      this.logger.log(
        `Starting automatic crawling from base URL: ${baseUrl}`,
      );

      while (urlsToVisit.length > 0 && this.visitedUrls.size < this.maxPages) {
        const currentUrl = urlsToVisit.shift()!;

        if (this.visitedUrls.has(currentUrl)) {
          continue;
        }

        try {
          this.logger.log(
            `Scraping page ${this.visitedUrls.size + 1}/${this.maxPages}: ${currentUrl}`,
          );

          const pageContent = await this.scrapeSinglePage(currentUrl);
          
          if (pageContent.trim().length > 0) {
            allContent.push(
              `\n\n=== Page: ${currentUrl} ===\n\n${pageContent}`,
            );
          }

          // Find links on this page
          const links = await this.extractLinks(currentUrl);

          // Add new links to queue (only same domain)
          for (const link of links) {
            if (
              !this.visitedUrls.has(link) &&
              !urlsToVisit.includes(link)
            ) {
              urlsToVisit.push(link);
            }
          }

          this.visitedUrls.add(currentUrl);

          // Small delay to be respectful to the server
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          this.logger.warn(
            `Failed to scrape ${currentUrl}: ${error.message}`,
          );
          // Continue with other pages
        }
      }

      const combinedContent = allContent.join('\n\n');
      this.logger.log(
        `Scraped ${this.visitedUrls.size} pages, total ${combinedContent.length} characters`,
      );

      if (combinedContent.trim().length === 0) {
        throw new HttpException(
          'No content found on any pages',
          HttpStatus.BAD_REQUEST,
        );
      }

      return combinedContent;
    } catch (error) {
      this.logger.error(`Error scraping website ${baseUrl}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to scrape website: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Scrape a single page
   */
  private async scrapeSinglePage(url: string): Promise<string> {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(response.data);

    // Remove script and style elements
    $('script, style, nav, footer, header, aside').remove();

    // Extract main content (adjust selectors based on your needs)
    const mainContent = $('main, article, .content, #content, body').first();

    if (!mainContent.length) {
      return '';
    }

    // Convert HTML to markdown for cleaner text
    const markdown = this.turndownService.turndown(mainContent.html() || '');

    // Clean up the text
    return this.cleanText(markdown);
  }

  /**
   * Extract all links from a page that go deeper into the same path structure
   * Example: If on /dashboard, only follows /dashboard/settings, not /contact
   */
  private async extractLinks(url: string): Promise<string[]> {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const $ = cheerio.load(response.data);
      const links: string[] = [];
      const baseUrlObj = new URL(url);
      const currentPath = baseUrlObj.pathname;

      // Remove navigation, footer, header, sidebar to avoid following those links
      $('nav, footer, header, aside, .nav, .navigation, .footer, .header, .sidebar, .menu').remove();

      // Find links only in main content areas (not in removed navigation/footer)
      const mainContent = $('main, article, .content, #content, .documentation, .docs-content, body');
      
      mainContent.find('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;

        try {
          // Convert relative URLs to absolute
          const absoluteUrl = new URL(href, url).href;
          const urlObj = new URL(absoluteUrl);

          // Only include same domain links
          if (urlObj.origin === baseUrlObj.origin) {
            const linkPath = urlObj.pathname;

            // Exclude common non-content paths and file types
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
              linkPath.includes('#') || // Skip anchor links
              urlObj.search || // Skip URLs with query parameters
              linkPath.length <= 1; // Skip root path

            if (isExcluded) {
              return;
            }

            // Only follow links that go deeper into the same path structure
            // Rule 1: If we're at root (/), follow any path that starts with /
            // Rule 2: If we're at a specific path like /dashboard, only follow /dashboard/* paths
            const isFromRoot = currentPath === '/' || currentPath === '';
            const isChildPath =
              linkPath.startsWith(currentPath) && linkPath !== currentPath;

            if (isFromRoot || isChildPath) {
              // Additional check: ensure the link is actually deeper (more path segments)
              const currentDepth = currentPath.split('/').filter((p) => p).length;
              const linkDepth = linkPath.split('/').filter((p) => p).length;
              
              // Allow same level or deeper, but not going up
              if (linkDepth >= currentDepth) {
                links.push(absoluteUrl);
              }
            }
          }
        } catch (error) {
          // Invalid URL, skip
        }
      });

      const uniqueLinks = [...new Set(links)]; // Remove duplicates
      this.logger.debug(
        `Extracted ${uniqueLinks.length} links from ${url} (current path: ${currentPath})`,
      );
      return uniqueLinks;
    } catch (error) {
      this.logger.warn(`Error extracting links from ${url}: ${error.message}`);
      return [];
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .replace(/\n{3,}/g, '\n\n') // Multiple newlines to double newline
      .trim();
  }
}
