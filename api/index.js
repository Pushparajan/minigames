/**
 * Vercel Serverless Entry Point
 * ==============================
 * Exports the Express app as a single serverless function.
 * Vercel routes all /api/* requests here via vercel.json rewrites.
 *
 * DB and Redis connections are lazy-initialized on first request
 * and persist across warm invocations.
 */

const app = require('../server/index');

module.exports = app;
