import type { MetadataRoute } from 'next';

/** Private staff app: tell every search engine to stay out. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
