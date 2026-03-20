export default {
    async fetch(request, env, ctx) {

        const BOT_TOKEN    = env.BOT_TOKEN;
        const STREAMER_URL = env.STREAMER_URL;

        const url  = new URL(request.url);
        const path = url.pathname;

        const corsHeaders = {
            'Access-Control-Allow-Origin':   '*',
            'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers':  'Range, Content-Type',
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
                JSON.stringify({
                    status:       'ok',
                    worker:       'telegram-stream',
                    streamer_set: !!STREAMER_URL
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    }
                }
            );
        }

        if (path === '/stream') {
            const fileId = url.searchParams.get('file_id');

            if (!fileId) {
                return new Response(
                    JSON.stringify({ error: 'file_id missing' }),
                    {
                        status: 400,
                        headers: {
                            'Content-Type': 'application/json',
                            ...corsHeaders
                        }
                    }
                );
            }

            // Pehle Bot API try karo (fast, 20MB tak)
            const botResult = await tryBotApi(
                request, fileId, corsHeaders, BOT_TOKEN
            );

            if (botResult) {
                return botResult;
            }

            // Bot API fail — Pyrogram use karo (unlimited!)
            if (STREAMER_URL) {
                return await tryPyrogram(
                    request, fileId, corsHeaders, STREAMER_URL
                );
            }

            return new Response(
                JSON.stringify({ error: 'No streamer available' }),
                {
                    status: 503,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    }
                }
            );
        }

        return new Response('Not Found', { status: 404 });
    }
};

// Bot API — 20MB tak
async function tryBotApi(request, fileId, corsHeaders, BOT_TOKEN) {
    try {
        const TG_API  = `https://api.telegram.org/bot${BOT_TOKEN}`;
        const TG_FILE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

        const infoRes  = await fetch(
            `${TG_API}/getFile?file_id=${fileId}`
        );
        const fileInfo = await infoRes.json();

        if (!fileInfo.ok) {
            return null;
        }

        const streamUrl    = `${TG_FILE}/${fileInfo.result.file_path}`;
        const rangeHeader  = request.headers.get('Range');
        const fetchHeaders = {};

        if (rangeHeader) {
            fetchHeaders['Range'] = rangeHeader;
        }

        const response = await fetch(streamUrl, {
            headers: fetchHeaders,
            cf: {
                cacheEverything: true,
                cacheTtl: 3600
            }
        });

        if (!response.ok && response.status !== 206) {
            return null;
        }

        const responseHeaders = {
            ...corsHeaders,
            'Content-Type':  response.headers.get('Content-Type')
                             || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
        };

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            responseHeaders['Content-Length'] = contentLength;
        }

        const contentRange = response.headers.get('Content-Range');
        if (contentRange) {
            responseHeaders['Content-Range'] = contentRange;
        }

        return new Response(response.body, {
            status:  response.status,
            headers: responseHeaders
        });

    } catch (e) {
        return null;
    }
}

// Pyrogram — Unlimited!
async function tryPyrogram(
    request, fileId, corsHeaders, STREAMER_URL
) {
    try {
        const rangeHeader  = request.headers.get('Range');
        const streamUrl    = `${STREAMER_URL}/stream?file_id=${fileId}`;
        const fetchHeaders = {};

        if (rangeHeader) {
            fetchHeaders['Range'] = rangeHeader;
        }

        const response = await fetch(streamUrl, {
            headers: fetchHeaders
        });

        const responseHeaders = {
            ...corsHeaders,
            'Content-Type':  'video/mp4',
            'Accept-Ranges': 'bytes',
        };

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            responseHeaders['Content-Length'] = contentLength;
        }

        const contentRange = response.headers.get('Content-Range');
        if (contentRange) {
            responseHeaders['Content-Range'] = contentRange;
        }

        return new Response(response.body, {
            status:  response.status,
            headers: responseHeaders
        });

    } catch (e) {
        return new Response(
            JSON.stringify({
                error:   'Stream failed',
                message: e.message
            }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            }
        );
    }
}
