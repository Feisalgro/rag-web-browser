import type { ProxyConfigurationOptions } from 'apify';
import { Actor } from 'apify';
import type { CheerioCrawlerOptions, ProxyConfiguration } from 'crawlee';
import { BrowserName, log } from 'crawlee';
import { firefox } from 'playwright';

import inputSchema from '../.actor/input_schema.json' with { type: 'json' };
import { ContentCrawlerTypes } from './const.js';
import { UserInputError } from './errors.js';
import type {
    ContentCrawlerOptions,
    ContentScraperSettings,
    Input,
    OutputFormats,
    ScrapingTool,
    SERPProxyGroup,
} from './types.js';

/**
 * Processes the input and returns an array of crawler settings. This is ideal for startup of STANDBY mode
 * because it makes it simple to start all crawlers at once.
 */
export async function processStandbyInput(originalInput: Partial<Input>) {
    const { input, searchCrawlerOptions, contentScraperSettings } = await processInputInternal(originalInput, true);

    const proxy = await Actor.createProxyConfiguration(input.proxyConfiguration);
    const contentCrawlerOptions: ContentCrawlerOptions[] = [
        createPlaywrightCrawlerOptions(input, proxy),
        createCheerioCrawlerOptions(input, proxy),
    ];

    return { input, searchCrawlerOptions, contentCrawlerOptions, contentScraperSettings };
}

/**
 * Processes the input and returns the settings for the crawler.
 */
export async function processInput(originalInput: Partial<Input>) {
    const { input, searchCrawlerOptions, contentScraperSettings } = await processInputInternal(originalInput);

    const proxy = await Actor.createProxyConfiguration(input.proxyConfiguration);
    const contentCrawlerOptions: ContentCrawlerOptions = input.scrapingTool === 'raw-http'
        ? createCheerioCrawlerOptions(input, proxy, false)
        : createPlaywrightCrawlerOptions(input, proxy, false);

    return { input, searchCrawlerOptions, contentCrawlerOptions, contentScraperSettings };
}

/**
 * Processes the input and returns the settings for the crawler (adapted from: Website Content Crawler).
 */
async function processInputInternal(
    originalInput: Partial<Input>,
    standbyInit = false,
) {
    // const input = { ...defaults, ...originalInput } as Input;

    const input = validateAndFillInput(originalInput, standbyInit);

    const {
        debugMode,
        dynamicContentWaitSecs,
        serpMaxRetries,
        serpProxyGroup,
        outputFormats,
        readableTextCharThreshold,
        removeElementsCssSelector,
        htmlTransformer,
        removeCookieWarnings,
        documentationMode,
        enableRecursiveCrawling,
        maxDepth,
        maxPagesPerDomain,
        followInternalLinks,
        includePatterns,
        excludePatterns,
    } = input;

    log.setLevel(debugMode ? log.LEVELS.DEBUG : log.LEVELS.INFO);

    const proxySearch = await Actor.createProxyConfiguration({ groups: [serpProxyGroup] });
    const searchCrawlerOptions: CheerioCrawlerOptions = {
        keepAlive: standbyInit,
        maxRequestRetries: serpMaxRetries,
        proxyConfiguration: proxySearch,
        autoscaledPoolOptions: { desiredConcurrency: 1 },
    };

    // Ensure includePatterns and excludePatterns are strings (comma-separated)
    if (Array.isArray(includePatterns)) {
        input.includePatterns = includePatterns.join(',');
    }
    if (Array.isArray(excludePatterns)) {
        input.excludePatterns = excludePatterns.join(',');
    }

    const contentScraperSettings: ContentScraperSettings = {
        debugMode,
        dynamicContentWaitSecs,
        htmlTransformer,
        maxHtmlCharsToProcess: 1.5e6,
        outputFormats,
        readableTextCharThreshold,
        removeCookieWarnings,
        removeElementsCssSelector,
        documentationMode: input.documentationMode,
        enableRecursiveCrawling: input.enableRecursiveCrawling,
        maxDepth: input.maxDepth,
        maxPagesPerDomain: input.maxPagesPerDomain,
        followInternalLinks: input.followInternalLinks,
        includePatterns: input.includePatterns,
        excludePatterns: input.excludePatterns,
    };

    return { input, searchCrawlerOptions, contentScraperSettings };
}

function createPlaywrightCrawlerOptions(
    input: Input,
    proxy: ProxyConfiguration | undefined,
    keepAlive = true,
): ContentCrawlerOptions {
    const { maxRequestRetries, desiredConcurrency } = input;

    return {
        type: ContentCrawlerTypes.PLAYWRIGHT,
        crawlerOptions: {
            headless: true,
            keepAlive,
            maxRequestRetries,
            proxyConfiguration: proxy,
            requestHandlerTimeoutSecs: input.requestTimeoutSecs,
            launchContext: {
                launcher: firefox,
            },
            browserPoolOptions: {
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: [BrowserName.firefox],
                    },
                },
                retireInactiveBrowserAfterSecs: 60,
            },
            autoscaledPoolOptions: {
                desiredConcurrency,
            },
        },
    };
}

function createCheerioCrawlerOptions(
    input: Input,
    proxy: ProxyConfiguration | undefined,
    keepAlive = true,
): ContentCrawlerOptions {
    const { maxRequestRetries, desiredConcurrency } = input;

    return {
        type: ContentCrawlerTypes.CHEERIO,
        crawlerOptions: {
            keepAlive,
            maxRequestRetries,
            proxyConfiguration: proxy,
            requestHandlerTimeoutSecs: input.requestTimeoutSecs,
            autoscaledPoolOptions: {
                desiredConcurrency,
            },
        },
    };
}

/**
 * Validates the input and fills in the default values where necessary.
 * Do not validate query parameter when standbyInit is true.
 * This is a bit ugly, but it's necessary to avoid throwing an error when the query is not provided in standby mode.
 */
function validateAndFillInput(input: Partial<Input>, standbyInit: boolean): Input {
    /* eslint-disable no-param-reassign */
    const validateRange = (
        value: number | string | undefined,
        min: number,
        max: number,
        defaultValue: number,
        fieldName: string,
    ) => {
        // parse the value as a number to check if it's a valid number
        if (value === undefined) {
            log.info(`The \`${fieldName}\` parameter is not defined. Using the default value ${defaultValue}.`);
            return defaultValue;
        } if (typeof value === 'string') {
            value = Number(value);
        } if (value < min) {
            log.warning(`The \`${fieldName}\` parameter must be at least ${min}, but was ${fieldName}. Using ${min} instead.`);
            return min;
        } if (value > max) {
            log.warning(`The \`${fieldName}\` parameter must be at most ${max}, but was ${fieldName}. Using ${max} instead.`);
            return max;
        }
        return value;
    };

    // Throw an error if the query is not provided and standbyInit is false.
    if (!input.query && !standbyInit) {
        throw new UserInputError('The `query` parameter must be provided and non-empty.');
    }

    // Max results
    input.maxResults = validateRange(
        input.maxResults,
        inputSchema.properties.maxResults.minimum,
        inputSchema.properties.maxResults.maximum,
        inputSchema.properties.maxResults.default,
        'maxResults',
    );

    // Output formats
    if (!input.outputFormats || input.outputFormats.length === 0) {
        input.outputFormats = inputSchema.properties.outputFormats.default as OutputFormats[];
        log.info(`The \`outputFormats\` parameter is not defined. Using default value \`${input.outputFormats}\`.`);
    } else if (input.outputFormats.some((format) => !['text', 'markdown', 'html'].includes(format))) {
        throw new UserInputError('The `outputFormats` array may only contain `text`, `markdown`, or `html`.');
    }

    // Request timout seconds
    input.requestTimeoutSecs = validateRange(
        input.requestTimeoutSecs,
        inputSchema.properties.requestTimeoutSecs.minimum,
        inputSchema.properties.requestTimeoutSecs.maximum,
        inputSchema.properties.requestTimeoutSecs.default,
        'requestTimeoutSecs',
    );

    // SERP proxy group
    if (!input.serpProxyGroup || input.serpProxyGroup.length === 0) {
        input.serpProxyGroup = inputSchema.properties.serpProxyGroup.default as SERPProxyGroup;
    } else if (input.serpProxyGroup !== 'GOOGLE_SERP' && input.serpProxyGroup !== 'SHADER') {
        throw new UserInputError('The `serpProxyGroup` parameter must be either `GOOGLE_SERP` or `SHADER`.');
    }

    // SERP max retries
    input.serpMaxRetries = validateRange(
        input.serpMaxRetries,
        inputSchema.properties.serpMaxRetries.minimum,
        inputSchema.properties.serpMaxRetries.maximum,
        inputSchema.properties.serpMaxRetries.default,
        'serpMaxRetries',
    );

    // Proxy configuration
    if (!input.proxyConfiguration) {
        input.proxyConfiguration = inputSchema.properties.proxyConfiguration.default as ProxyConfigurationOptions;
    }

    // Scraping tool
    if (!input.scrapingTool) {
        input.scrapingTool = inputSchema.properties.scrapingTool.default as ScrapingTool;
    } else if (input.scrapingTool !== 'browser-playwright' && input.scrapingTool !== 'raw-http') {
        throw new UserInputError('The `scrapingTool` parameter must be either `browser-playwright` or `raw-http`.');
    }

    // Remove elements CSS selector
    if (!input.removeElementsCssSelector) {
        input.removeElementsCssSelector = inputSchema.properties.removeElementsCssSelector.default;
    }

    // HTML transformer
    if (!input.htmlTransformer) {
        input.htmlTransformer = inputSchema.properties.htmlTransformer.default;
    }

    // Desired concurrency
    input.desiredConcurrency = validateRange(
        input.desiredConcurrency,
        inputSchema.properties.desiredConcurrency.minimum,
        inputSchema.properties.desiredConcurrency.maximum,
        inputSchema.properties.desiredConcurrency.default,
        'desiredConcurrency',
    );

    // Max request retries
    input.maxRequestRetries = validateRange(
        input.maxRequestRetries,
        inputSchema.properties.maxRequestRetries.minimum,
        inputSchema.properties.maxRequestRetries.maximum,
        inputSchema.properties.maxRequestRetries.default,
        'maxRequestRetries',
    );

    // Dynamic content wait seconds
    if (!input.dynamicContentWaitSecs || input.dynamicContentWaitSecs >= input.requestTimeoutSecs) {
        input.dynamicContentWaitSecs = Math.round(input.requestTimeoutSecs / 2);
    }

    // Remove cookie warnings
    if (input.removeCookieWarnings === undefined) {
        input.removeCookieWarnings = inputSchema.properties.removeCookieWarnings.default;
    }

    // Debug mode
    if (input.debugMode === undefined) {
        input.debugMode = inputSchema.properties.debugMode.default;
    }

    // Documentation mode
    if (input.documentationMode === undefined) {
        input.documentationMode = inputSchema.properties.documentationMode.default;
    }

    // Enable recursive crawling
    if (input.enableRecursiveCrawling === undefined) {
        input.enableRecursiveCrawling = inputSchema.properties.enableRecursiveCrawling.default;
    }

    // Max depth
    if (input.maxDepth === undefined) {
        input.maxDepth = inputSchema.properties.maxDepth.default;
    }

    // Max pages per domain
    if (input.maxPagesPerDomain === undefined) {
        input.maxPagesPerDomain = inputSchema.properties.maxPagesPerDomain.default;
    }

    // Follow internal links
    if (input.followInternalLinks === undefined) {
        input.followInternalLinks = inputSchema.properties.followInternalLinks.default;
    }

    // Include patterns
    if (input.includePatterns === undefined) {
        input.includePatterns = inputSchema.properties.includePatterns.default;
    }

    // Exclude patterns
    if (input.excludePatterns === undefined) {
        input.excludePatterns = inputSchema.properties.excludePatterns.default;
    }

    // Documentation mode enhancements
    if (input.documentationMode) {
        // Enhanced selectors for documentation sites
        const docSelectors = [
            input.removeElementsCssSelector,
            '.sidebar, .navigation, .toc, .breadcrumb',
            '.search-box, .search-results',
            '.advertisement, .ads, .sponsor',
            '.comment-section, .comments',
            '.related-posts, .suggestions',
            '.footer-nav, .footer-links',
            '.social-share, .share-buttons',
            '.version-selector, .language-selector',
            '.edit-button, .contribute-link'
        ].filter(Boolean).join(', ');
        
        input.removeElementsCssSelector = docSelectors;
        
        // Enable recursive crawling by default in documentation mode
        if (!input.enableRecursiveCrawling) {
            input.enableRecursiveCrawling = true;
        }
        
        // Set reasonable defaults for documentation crawling
        if (input.maxDepth === 2) {
            input.maxDepth = 3;
        }
        
        if (input.maxPagesPerDomain === 20) {
            input.maxPagesPerDomain = 50;
        }
    }

    return input as Input;
    /* eslint-enable no-param-reassign */
}
