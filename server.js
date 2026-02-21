/* ——————————————————————————————
   YTFree — Node.js Backend
   Search via youtube-sr, Streaming via @distube/ytdl-core, Google OAuth2
   —————————————————————————————— */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
const YouTube = require('youtube-sr').default;
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Google OAuth2 Setup =====
const hasOAuth = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
const PUBLIC_URL = process.env.URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`;

let oauth2Client;
if (hasOAuth) {
    oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${PUBLIC_URL}/auth/google/callback`
    );
    console.log(`[Auth] Google OAuth2 configured with redirect: ${PUBLIC_URL}/auth/google/callback`);
    console.log('[Auth] Google OAuth2 configured');
} else {
    console.log('[Auth] No Google credentials found — account features disabled');
}

// ===== Middleware =====
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'ytfree-default-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));


const { Innertube, UniversalCache } = require('youtubei.js');

let ytInstance = null;
async function getYt() {
    if (!ytInstance) {
        ytInstance = await Innertube.create({ cache: new UniversalCache(false) });
    }
    return ytInstance;
}

// ===== YouTube Scraper API (youtubei.js for search & ytdl-core/yt-dlp for streams) =====

// Search
app.get('/api/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        if (!q) return res.json([]);
        console.log(`[Search] Query: "${q}"`);

        const yt = await getYt();
        const results = await yt.search(q, { type: 'video' });

        // Convert to frontend expected format
        const mapped = results.videos.slice(0, 20).map(v => {
            let durationSeconds = 0;
            if (v.duration && v.duration.seconds) {
                durationSeconds = v.duration.seconds;
            }
            let viewCount = 0;
            if (v.view_count) {
                viewCount = parseInt(v.view_count.text?.replace(/[^0-9]/g, '')) || 0;
            } else if (v.short_view_count) {
                viewCount = v.short_view_count.text; // fallback
            }

            return {
                type: 'video',
                videoId: v.id,
                title: v.title?.text || 'Unknown',
                author: v.author?.name || 'Unknown',
                lengthSeconds: durationSeconds,
                viewCount: viewCount,
                videoThumbnails: v.thumbnails?.length ? [{ url: v.thumbnails[0].url, quality: 'high' }] : []
            };
        });

        res.json(mapped);
    } catch (err) {
        console.error('[Search Error]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Stream proxy
// Pipes the video/audio stream through our backend to bypass CORS entirely
const youtubedl = require('youtube-dl-exec');

app.get('/api/stream', async (req, res) => {
    try {
        const id = req.query.id;
        const type = req.query.type || 'video';
        if (!id) return res.status(400).json({ error: 'Missing video ID' });

        console.log(`[Stream] Proxying ${type} for ${id} via yt-dlp...`);

        // Get formats using yt-dlp
        // Impersonate Android/Web clients to bypass "Sign in to confirm you're not a bot" on datacenter IPs
        const info = await youtubedl(`https://www.youtube.com/watch?v=${id}`, {
            dumpJson: true,
            noWarnings: true,
            noCheckCertificate: true,
            extractorArgs: 'youtube:player_client=android,web'
        });

        const formats = info.formats || [];
        let format;

        if (type === 'audio') {
            const audioFmts = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none').sort((a, b) => (b.abr || 0) - (a.abr || 0));
            format = audioFmts[0];
        } else {
            // Best video up to 720p with an audio codec (muxed)
            const videoFmts = formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && (f.height || 0) <= 720).sort((a, b) => (b.height || 0) - (a.height || 0));
            format = videoFmts[0];

            // Fallback to video only
            if (!format) {
                const vOnly = formats.filter(f => f.vcodec !== 'none' && (f.height || 0) <= 720).sort((a, b) => (b.height || 0) - (a.height || 0));
                format = vOnly[0];
            }
        }

        if (!format || !format.url) {
            throw new Error('No playable stream found');
        }

        console.log(`[Stream] Format selected: ${format.format_id} (${format.ext})`);

        // Fetch the actual stream and pipe it to the client
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        };
        if (req.headers.range) headers['Range'] = req.headers.range;

        // Using native fetch in Node 18+
        const fetchResponse = await fetch(format.url, {
            method: 'GET',
            headers
        });

        if (!fetchResponse.ok && fetchResponse.status !== 206) {
            throw new Error(`YouTube returned status ${fetchResponse.status}`);
        }

        // Proxy the relevant headers back to the client
        res.status(fetchResponse.status);
        res.header('Content-Type', type === 'audio' ? 'audio/webm' : 'video/mp4');

        ['content-length', 'content-range', 'accept-ranges'].forEach(h => {
            const val = fetchResponse.headers.get(h);
            if (val) res.header(h, val);
        });

        // Node wrapper for fetch body (WebReadableStream -> Node Readable)
        const { Readable } = require('stream');
        Readable.fromWeb(fetchResponse.body).pipe(res);

    } catch (err) {
        console.error('[Stream Error]', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to stream: ' + err.message });
    }
});


// ===== Google OAuth2 Routes =====

app.get('/auth/status', (req, res) => {
    res.json({
        oauthAvailable: !!hasOAuth,
        loggedIn: !!req.session.tokens,
        user: req.session.user || null,
    });
});

app.get('/auth/google', (req, res) => {
    if (!hasOAuth) {
        // Fallback mock login so the app still demonstrates library features
        req.session.tokens = { mock: true };
        req.session.user = { name: 'Demo User', email: 'demo@ytfree.app', picture: 'https://ui-avatars.com/api/?name=Demo&background=7c3aed&color=fff' };
        return res.redirect('/?loggedIn=1');
    }
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
        ],
        prompt: 'consent',
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    if (!oauth2Client) return res.redirect('/');
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        req.session.tokens = tokens;
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();
        req.session.user = { name: data.name, email: data.email, picture: data.picture };
        res.redirect('/?loggedIn=1');
    } catch (err) {
        console.error('[Auth Error]', err.message);
        res.redirect('/?authError=1');
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ ok: true });
});

// ===== YouTube Data API v3 (Library) =====

function getAuthClient(req) {
    if (!oauth2Client || !req.session.tokens || req.session.tokens.mock) return null;
    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${PUBLIC_URL}/auth/google/callback`
    );
    client.setCredentials(req.session.tokens);
    return client;
}

function requireAuth(req, res, next) {
    if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
    next();
}

// Mock Data for Library when no Google Cloud Project is setup
const mockPlaylists = {
    items: [
        { id: 'RDCLAK5uy_kQyOtwyvIqgWIF0t-kQ2F5-n_27S1jY7E', snippet: { title: 'Lofi Beats', channelTitle: 'YT Music', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/jfKfPfyJRdk/mqdefault.jpg' } } }, contentDetails: { itemCount: 1 } }
    ]
};
const mockLiked = {
    items: [
        { id: 'jfKfPfyJRdk', snippet: { title: 'lofi hip hop radio 📚 beats to relax/study to', channelTitle: 'Lofi Girl', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/jfKfPfyJRdk/mqdefault.jpg' } }, resourceId: { videoId: 'jfKfPfyJRdk' } } }
    ]
};
const mockSubs = {
    items: [
        { snippet: { title: 'Lofi Girl', thumbnails: { default: { url: 'https://yt3.ggpht.com/ytc/AIdro_k6T6-uY5qH0VnRyY8FxbNq9GgVlQzVw72-5bxgKzg=s88-c-k-c0x00ffffff-no-rj' } }, resourceId: { channelId: 'UCSJ4gkVC6NrvII8umztf0Ow' } } },
        { snippet: { title: 'ChilledCow', thumbnails: { default: { url: 'https://yt3.ggpht.com/ytc/AIdro_k6T6-uY5qH0VnRyY8FxbNq9GgVlQzVw72-5bxgKzg=s88-c-k-c0x00ffffff-no-rj' } }, resourceId: { channelId: 'UCSJ4gkVC6NrvII8umztf0Ow' } } }
    ]
};

app.get('/api/my/playlists', requireAuth, async (req, res) => {
    try {
        if (req.session.tokens.mock) return res.json(mockPlaylists);
        const youtube = google.youtube({ version: 'v3', auth: getAuthClient(req) });
        const response = await youtube.playlists.list({ part: 'snippet,contentDetails', mine: true, maxResults: 50 });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/my/playlist/:id', requireAuth, async (req, res) => {
    try {
        if (req.session.tokens.mock) return res.json(mockLiked); // Just return liked mock for any playlist detail
        const youtube = google.youtube({ version: 'v3', auth: getAuthClient(req) });
        const response = await youtube.playlistItems.list({ part: 'snippet,contentDetails', playlistId: req.params.id, maxResults: 50 });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/my/liked', requireAuth, async (req, res) => {
    try {
        if (req.session.tokens.mock) return res.json(mockLiked);
        const youtube = google.youtube({ version: 'v3', auth: getAuthClient(req) });
        const response = await youtube.videos.list({ part: 'snippet,contentDetails', myRating: 'like', maxResults: 50 });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/my/subscriptions', requireAuth, async (req, res) => {
    try {
        if (req.session.tokens.mock) return res.json(mockSubs);
        const youtube = google.youtube({ version: 'v3', auth: getAuthClient(req) });
        const response = await youtube.subscriptions.list({ part: 'snippet', mine: true, maxResults: 50, order: 'alphabetical' });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// SPA Catch-all
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  🎵 YTFree v2 Backend is running at http://localhost:${PORT}`);
    console.log(`  📺 Search: youtube-sr | Streams: @distube/ytdl-core`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
