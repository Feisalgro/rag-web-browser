import type { CheerioAPI } from 'cheerio';
// @ts-ignore
import { URL } from 'url';
// @ts-expect-error
import { log } from 'apify';

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
    const allHrefs: string[] = [];
    $('a[href]').each((index: number, element: any) => {
        const href = $(element).attr('href');
        if (!href) return;
        allHrefs.push(href);
    });
    log.info(`Found ${allHrefs.length} <a href> links on ${options.baseUrl}`);
    for (const href of allHrefs) {
        let url: string;
        try {
            url = new URL(href, baseUrl).toString();
        } catch {
            log.debug(`Skipping invalid URL: ${href}`);
            continue;
        }
        // Pattern matching
        const path = new URL(url).pathname;
        const includeArray = options.includePatterns ? options.includePatterns.split(',').map(p => p.trim()).filter(Boolean) : [];
        const excludeArray = options.excludePatterns ? options.excludePatterns.split(',').map(p => p.trim()).filter(Boolean) : [];
        let included = true;
        if (includeArray.length > 0) {
            included = includeArray.some(pattern => path.startsWith(pattern.replace(/\*\*$/, '')));
        }
        if (excludeArray.length > 0 && excludeArray.some(pattern => path.startsWith(pattern.replace(/\*\*$/, '')))) {
            included = false;
        }
        log.info(`Link: ${url} | Path: ${path} | Included: ${included}`);
        if (!included) continue;
        if (options.visitedUrls.has(url)) continue;
        const isInternal = url.startsWith(baseUrl.origin);
        links.push({
            url,
            title: '',
            depth: 0,
            isInternal,
        });
    }
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