/**
 * Custom Next.js server for WACRM
 * Properly handles App Router routes and API endpoints
 */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    createServer(async (req, res) => {
        try {
            // Parse the URL
            const parsedUrl = parse(req.url, true);
            const { pathname, query } = parsedUrl;

            // Log incoming requests in development
            if (dev) {
                console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);
            }

            // Handle the request through Next.js
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('[Server Error]', req.url, err);
            res.statusCode = 500;
            res.end('Internal server error');
        }
    }).listen(port, hostname, (err) => {
        if (err) {
            console.error('[Server Error]', err);
            process.exit(1);
        }
        console.log(`[WACRM] Server ready on http://${hostname}:${port}`);
        console.log(`[WACRM] Environment: ${dev ? 'development' : 'production'}`);
        console.log(`[WACRM] API routes available at http://${hostname}:${port}/api/*`);
    });
});
