export default {
    async fetch(request, env, ctx) {

        const BOT_TOKEN = env.BOT_TOKEN;

        if (!BOT_TOKEN) {
            return new Response(
                JSON.stringify({ error: 'BOT_TOKEN not set' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const TG_API  = `https://api.telegram.org/bot${BOT_TOKEN}`;
        const TG_FILE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

        const url  = new URL(request.url);
        const path = url.pathname;

        const corsHeaders = {
            'Access-Control-Allow-Origin':  '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders
            });
        }

        if (path === '/' || path === '/health') {
            return new Response(
                JSON.stringify({ status: 'ok', worker: 'telegram-stream' }),
                { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
            );
        }

        if (path === '/stream') {
            const fileId = url.searchParams.get('file_id');

            if (!fileId) {
                return new Response(
                    JSON.stringify({ error: 'file_id missing' }),
                    { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
                );
            }

            return await streamVideo(request, fileId, corsHeaders, TG_API, TG_FILE);
        }

        return new Response('Not Found', { status: 404 });
    }
};

async function streamVideo(request, fileId, corsHeaders, TG_API, TG_FILE) {
    try {
        // Step 1: File info lo
        const infoResponse = await fetch(
            `${TG_API}/getFile?file_id=${fileId}`
        );
        const fileInfo = await infoResponse.json();

        if (!fileInfo.ok) {
            return new Response(
                JSON.stringify({
                    error: 'Telegram file not found',
                    details: fileInfo,
                    hint: 'File 20MB se badi hai ya expired hai'
                }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                }
            );
        }

        // Step 2: Direct stream URL
        const filePath  = fileInfo.result.file_path;
        const fileSize  = fileInfo.result.file_size;
        const streamUrl = `${TG_FILE}/${filePath}`;

        // Step 3: Range header handle karo
        const rangeHeader = request.headers.get('Range');
        const fetchInit   = { headers: {} };

        if (rangeHeader) {
            fetchInit.headers['Range'] = rangeHeader;
        }

        // Step 4: Cloudflare cache ke saath fetch
        fetchInit.cf = {
            cacheEverything: true,
            cacheTtl: 3600,
            cacheKey: `tg-file-${fileId}`
        };

        const response = await fetch(streamUrl, fetchInit);

        if (!response.ok && response.status !== 206) {
            return new Response(
                JSON.stringify({
                    error: 'Fetch failed',
                    status: response.status,
                    hint: 'File 20MB limit cross kar gayi hogi'
                }),
                {
                    status: response.status,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                }
            );
        }

        // Step 5: Response headers
        const responseHeaders = {
            ...corsHeaders,
            'Content-Type':   response.headers.get('Content-Type') || 'video/mp4',
            'Accept-Ranges':  'bytes',
            'Cache-Control':  'public, max-age=3600',
        };

        if (fileSize) {
            responseHeaders['Content-Length'] = String(fileSize);
        }

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            responseHeaders['Content-Length'] = contentLength;
        }

        const contentRange = response.headers.get('Content-Range');
        if (contentRange) {
            responseHeaders['Content-Range'] = contentRange;
        }

        return new Response(response.body, {
            status:  rangeHeader ? 206 : 200,
            headers: responseHeaders
        });

    } catch (error) {
        return new Response(
            JSON.stringify({
                error:   'Stream error',
                message: error.message
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            }
        );
    }
}
