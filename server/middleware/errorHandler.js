/**
 * Global Error Handler
 * =====================
 * Catches unhandled errors and returns clean JSON responses.
 */

function errorHandler(err, req, res, _next) {
    const status = err.status || err.statusCode || 500;
    const message = status < 500 ? err.message : 'Internal server error';

    if (status >= 500) {
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
    }

    res.status(status).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

module.exports = { errorHandler };
