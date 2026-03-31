/* eslint-disable */
// @ts-nocheck
/**
 * HTML to Markdown conversion shim for vendored OpenGrok-native tools.
 *
 * Uses simple regex-based conversion. Falls back to returning raw HTML
 * if the full rehype/remark pipeline is not available.
 */

/**
 * Convert HTML to markdown-like text.
 * Simplified version - strips tags and preserves text content.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  if (!html) return '';

  try {
    // Try to use the unified pipeline if available
    const { unified } = await import('unified');
    const rehypeParse = (await import('rehype-parse')).default;
    const rehypeRemark = (await import('rehype-remark')).default;
    const remarkGfm = (await import('remark-gfm')).default;
    const remarkStringify = (await import('remark-stringify')).default;

    const file = await unified()
      .use(rehypeParse)
      .use(rehypeRemark)
      .use(remarkGfm)
      .use(remarkStringify)
      .process(html);

    return String(file);
  } catch {
    // Fallback: simple HTML tag stripping
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<h[1-6][^>]*>/gi, '## ')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
