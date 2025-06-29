import type { CheerioAPI } from 'cheerio';
import { URL } from 'url';

export interface LinkDiscoveryOptions {
    baseUrl: string;
    maxDepth: number;
    maxPagesPerDomain: number;
    followInternalLinks: boolean;
    includePatterns: string;
    excludePatterns: string;
    visitedUrls: Set<string>;
}

export interface DiscoveredLink {
    url: string;
    title: string;
    depth: number;
    isInternal: boolean;
}

export function discoverLinks($: CheerioAPI, options: LinkDiscoveryOptions): DiscoveredLink[] {
    const links: DiscoveredLink[] = [];
    const baseUrl = new URL(options.baseUrl);
    
    $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;
        
        try {
            const absoluteUrl = new URL(href, baseUrl.origin);
            const relativePath = absoluteUrl.pathname;
            
            // Check if it's an internal link
            const isInternal = absoluteUrl.hostname === baseUrl.hostname;
            
            if (!isInternal && !options.followInternalLinks) return;
            
            // Check include/exclude patterns
            if (!matchesPatterns(relativePath, options.includePatterns, options.excludePatterns)) {
                return;
            }
            
            // Skip if already visited
            if (options.visitedUrls.has(absoluteUrl.href)) return;
            
            // Check domain limit
            if (isInternal && options.visitedUrls.size >= options.maxPagesPerDomain) return;
            
            links.push({
                url: absoluteUrl.href,
                title: $(element).text().trim() || absoluteUrl.pathname,
                depth: 1, // Will be updated by caller
                isInternal
            });
        } catch (error) {
            // Skip invalid URLs
        }
    });
    
    return links;
}

function matchesPatterns(path: string, includePatterns: string, excludePatterns: string): boolean {
    // Convert comma-separated strings to arrays
    const includeArray = includePatterns ? includePatterns.split(',').map(p => p.trim()).filter(Boolean) : [];
    const excludeArray = excludePatterns ? excludePatterns.split(',').map(p => p.trim()).filter(Boolean) : [];
    
    // Check exclude patterns first
    for (const pattern of excludeArray) {
        if (matchesGlobPattern(path, pattern)) {
            return false;
        }
    }
    
    // If no include patterns, include everything
    if (includeArray.length === 0) {
        return true;
    }
    
    // Check include patterns
    for (const pattern of includeArray) {
        if (matchesGlobPattern(path, pattern)) {
            return true;
        }
    }
    
    return false;
}

function matchesGlobPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\./g, '\\.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
} 