/**
 * Localization Middleware
 * ========================
 * Detects user locale from Accept-Language header or player profile,
 * and provides locale-specific formatting for currencies, dates, and text.
 *
 * Supported locales: en-US, es-ES, fr-FR, de-DE, pt-BR, ja-JP, ko-KR, zh-CN
 */

// Locale-specific currency symbols and formatting
const CURRENCY_CONFIG = {
    USD: { symbol: '$', position: 'before', decimals: 2 },
    EUR: { symbol: '\u20AC', position: 'before', decimals: 2 },
    GBP: { symbol: '\u00A3', position: 'before', decimals: 2 },
    BRL: { symbol: 'R$', position: 'before', decimals: 2 },
    JPY: { symbol: '\u00A5', position: 'before', decimals: 0 },
    KRW: { symbol: '\u20A9', position: 'before', decimals: 0 },
    CNY: { symbol: '\u00A5', position: 'before', decimals: 2 },
    INR: { symbol: '\u20B9', position: 'before', decimals: 2 }
};

// Locale to default currency mapping
const LOCALE_CURRENCY = {
    'en-US': 'USD',
    'en-GB': 'GBP',
    'es-ES': 'EUR',
    'fr-FR': 'EUR',
    'de-DE': 'EUR',
    'pt-BR': 'BRL',
    'ja-JP': 'JPY',
    'ko-KR': 'KRW',
    'zh-CN': 'CNY',
    'hi-IN': 'INR'
};

// Locale to region mapping (for matchmaking)
const LOCALE_REGION = {
    'en-US': 'us-east',
    'en-GB': 'eu-west',
    'es-ES': 'eu-west',
    'fr-FR': 'eu-west',
    'de-DE': 'eu-central',
    'pt-BR': 'sa-east',
    'ja-JP': 'asia-east',
    'ko-KR': 'asia-east',
    'zh-CN': 'asia-east',
    'hi-IN': 'asia-south'
};

const SUPPORTED_LOCALES = Object.keys(LOCALE_CURRENCY);

/**
 * Express middleware to detect and attach locale info.
 * Sets req.locale, req.currency, req.suggestedRegion
 */
function localeDetector(req, res, next) {
    // Priority: 1) Player profile, 2) Query param, 3) Accept-Language header
    let locale = null;

    // From player profile (if authenticated)
    if (req.player?.locale) {
        locale = req.player.locale;
    }

    // From query parameter
    if (!locale && req.query.locale) {
        locale = req.query.locale;
    }

    // From Accept-Language header
    if (!locale) {
        const acceptLang = req.headers['accept-language'];
        if (acceptLang) {
            locale = _parseAcceptLanguage(acceptLang);
        }
    }

    // Default
    if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
        locale = 'en-US';
    }

    req.locale = locale;
    req.currency = LOCALE_CURRENCY[locale] || 'USD';
    req.suggestedRegion = LOCALE_REGION[locale] || 'us-east';
    req.currencyConfig = CURRENCY_CONFIG[req.currency] || CURRENCY_CONFIG.USD;

    next();
}

/**
 * Parse Accept-Language header and find best match.
 */
function _parseAcceptLanguage(header) {
    const langs = header.split(',')
        .map(part => {
            const [lang, q] = part.trim().split(';q=');
            return { lang: lang.trim(), quality: q ? parseFloat(q) : 1.0 };
        })
        .sort((a, b) => b.quality - a.quality);

    for (const { lang } of langs) {
        // Exact match
        if (SUPPORTED_LOCALES.includes(lang)) return lang;
        // Language-only match (e.g., "en" -> "en-US")
        const prefix = lang.split('-')[0];
        const match = SUPPORTED_LOCALES.find(l => l.startsWith(prefix + '-'));
        if (match) return match;
    }

    return null;
}

/**
 * Format a currency amount for the given locale/currency.
 */
function formatCurrency(amount, currency) {
    const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
    const formatted = amount.toFixed(config.decimals);
    return config.position === 'before'
        ? `${config.symbol}${formatted}`
        : `${formatted}${config.symbol}`;
}

/**
 * Get locale config for a given locale string.
 */
function getLocaleConfig(locale) {
    return {
        locale,
        currency: LOCALE_CURRENCY[locale] || 'USD',
        region: LOCALE_REGION[locale] || 'us-east',
        currencyConfig: CURRENCY_CONFIG[LOCALE_CURRENCY[locale]] || CURRENCY_CONFIG.USD
    };
}

module.exports = {
    localeDetector,
    formatCurrency,
    getLocaleConfig,
    SUPPORTED_LOCALES,
    LOCALE_CURRENCY,
    LOCALE_REGION,
    CURRENCY_CONFIG
};
