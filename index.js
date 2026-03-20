export default {
    async fetch(request, env, ctx) {

        // env se BOT_TOKEN lo
        const BOT_TOKEN = env.BOT_TOKEN;

        if (!BOT_TOKEN) {
            return new Response(
                JSON.stringify({ error: 'BOT_TOKEN not configured' }),
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
            'Access-Control-Allow-Headers': '*',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
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
        const fileInfo = await getFileInfo(fileId, TG_API);

        if (!fileInfo.ok) {
            return new Response(
                JSON.stringify({ error: 'File not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
            );
        }

        const filePath  = fileInfo.result.file_path;
        const streamUrl = `${TG_FILE}/${filePath}`;

        const rangeHeader  = request.headers.get('Range');
        const fetchHeaders = {};
        if (rangeHeader) {
            fetchHeaders['Range'] = rangeHeader;
        }

        const response = await fetch(streamUrl, {
            headers: fetchHeaders,
            cf: { cacheEverything: true, cacheTtl: 86400 }
        });

        const responseHeaders = {
            ...corsHeaders,
            'Content-Type':  response.headers.get('Content-Type') || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400',
        };

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) responseHeaders['Content-Length'] = contentLength;

        const contentRange = response.headers.get('Content-Range');
        if (contentRange) responseHeaders['Content-Range'] = contentRange;

        return new Response(response.body, {
            status:  response.status,
            headers: responseHeaders
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: 'Stream failed', message: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
    }
}

async function getFileInfo(fileId, TG_API) {
    try {
        const response = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
        return await response.json();
    } catch (error) {
        return { ok: false, error: error.message };
    }
}
