// Helper functions

/**
 * Format a date to a readable string
 * @param {Date} date
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Calculate time ago from a given date
 * @param {Date} date
 * @returns {string} Time ago in a human-readable format
 */
function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = Math.floor(seconds / 31536000);
    if (interval > 1) return `${interval} years ago`;
    interval = Math.floor(seconds / 2592000);
    if (interval > 1) return `${interval} months ago`;
    interval = Math.floor(seconds / 86400);
    if (interval > 1) return `${interval} days ago`;
    interval = Math.floor(seconds / 3600);
    if (interval > 1) return `${interval} hours ago`;
    interval = Math.floor(seconds / 60);
    if (interval > 1) return `${interval} minutes ago`;
    return `${seconds} seconds ago`;
}

/**
 * Extract hashtags from a string
 * @param {string} text
 * @returns {Array} Array of hashtags
 */
function extractHashtags(text) {
    return text.match(/#\w+/g) || [];
}

/**
 * Extract mentions from a string
 * @param {string} text
 * @returns {Array} Array of mentions
 */
function extractMentions(text) {
    return text.match(/@\w+/g) || [];
}

/**
 * Abbreviate a number
 * @param {number} num
 * @returns {string} Abbreviated number
 */
function abbreviateNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
}

// Exporting functions for use
module.exports = {
    formatDate,
    timeAgo,
    extractHashtags,
    extractMentions,
    abbreviateNumber
};