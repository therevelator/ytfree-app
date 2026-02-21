/* ——————————————————————————————
   YTFree — Ad-Free YouTube Player
   Frontend app logic (Node.js backend)
   —————————————————————————————— */

(() => {
  'use strict';

  // ===== State =====
  const state = {
    queue: [],
    queueIndex: -1,
    audioMode: false,
    isPlaying: false,
    currentVideo: null,
    user: null,
    oauthAvailable: false,
    currentLibraryTab: 'playlists',
    currentPlaylistItems: [],
    currentPlaylistId: null,
  };

  // ===== DOM Refs =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    searchInput: $('#search-input'),
    searchBtn: $('#search-btn'),
    toggleQueueBtn: $('#toggle-queue-btn'),
    toggleLibraryBtn: $('#toggle-library-btn'),
    queueBadge: $('#queue-badge'),
    welcomeSection: $('#welcome-section'),
    resultsSection: $('#results-section'),
    playerSection: $('#player-section'),
    librarySection: $('#library-section'),
    playlistDetailSection: $('#playlist-detail-section'),
    resultsGrid: $('#results-grid'),
    resultsTitle: $('#results-title'),
    resultsCount: $('#results-count'),
    resultsLoading: $('#results-loading'),
    resultsError: $('#results-error'),
    videoContainer: $('#video-container'),
    videoPlayer: $('#video-player'),
    audioPlayer: $('#audio-player'),
    videoOverlay: $('#video-overlay'),
    playerTitle: $('#player-title'),
    playerAuthor: $('#player-author'),
    playPauseBtn: $('#play-pause-btn'),
    prevBtn: $('#prev-btn'),
    nextBtn: $('#next-btn'),
    muteBtn: $('#mute-btn'),
    volumeSlider: $('#volume-slider'),
    progressSlider: $('#progress-slider'),
    timeCurrent: $('#time-current'),
    timeTotal: $('#time-total'),
    audioModeBtn: $('#audio-mode-btn'),
    pipBtn: $('#pip-btn'),
    iconPlay: $('#icon-play'),
    iconPause: $('#icon-pause'),
    iconVol: $('#icon-vol'),
    iconMuted: $('#icon-muted'),
    queueSidebar: $('#queue-sidebar'),
    queueList: $('#queue-list'),
    clearQueueBtn: $('#clear-queue-btn'),
    loginBtn: $('#login-btn'),
    userBtn: $('#user-btn'),
    userAvatar: $('#user-avatar'),
    userDropdown: $('#user-dropdown'),
    dropdownAvatar: $('#dropdown-avatar'),
    dropdownName: $('#dropdown-name'),
    dropdownEmail: $('#dropdown-email'),
    logoutBtn: $('#logout-btn'),
    libraryLoginPrompt: $('#library-login-prompt'),
    libraryLoginBtn: $('#library-login-btn'),
    libraryContent: $('#library-content'),
    libraryGrid: $('#library-grid'),
    libraryLoading: $('#library-loading'),
    libraryError: $('#library-error'),
    oauthNotConfigured: $('#oauth-not-configured'),
    playlistDetailTitle: $('#playlist-detail-title'),
    playlistDetailCount: $('#playlist-detail-count'),
    playlistDetailGrid: $('#playlist-detail-grid'),
    playlistDetailLoading: $('#playlist-detail-loading'),
    playlistBackBtn: $('#playlist-back-btn'),
    playAllBtn: $('#play-all-btn'),
    closeQueueBtn: $('#close-queue-btn'),
  };

  // ===== API Helpers =====
  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ===== Sections =====
  function showSection(section) {
    $$('.content-section').forEach(s => s.classList.remove('active'));
    section.classList.add('active');
  }

  // ===== Search =====
  async function performSearch() {
    const query = dom.searchInput.value.trim();
    if (!query) return;

    showSection(dom.resultsSection);
    dom.resultsGrid.innerHTML = '';
    dom.resultsError.style.display = 'none';
    dom.resultsLoading.style.display = 'flex';
    dom.resultsTitle.textContent = `Results for "${query}"`;
    dom.resultsCount.textContent = '';

    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      dom.resultsLoading.style.display = 'none';

      const results = data.filter(item => item.type === 'video');
      if (results.length === 0) {
        dom.resultsError.textContent = 'No results found. Try a different query.';
        dom.resultsError.style.display = 'block';
        return;
      }

      dom.resultsCount.textContent = `${results.length} videos`;
      results.forEach((video, i) => {
        dom.resultsGrid.appendChild(createResultCard(video, i));
      });
    } catch (err) {
      dom.resultsLoading.style.display = 'none';
      dom.resultsError.textContent = err.message;
      dom.resultsError.style.display = 'block';
    }
  }

  function createResultCard(video, index) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.animationDelay = `${index * 0.05}s`;

    const thumbUrl = getBestThumb(video);
    const duration = formatTime(video.lengthSeconds || 0);
    const views = formatViews(video.viewCount || 0);

    card.innerHTML = `
      <div class="result-thumb">
        <img src="${thumbUrl}" alt="" loading="lazy">
        <div class="result-thumb-overlay">
          <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
        <span class="result-duration">${duration}</span>
      </div>
      <div class="result-info">
        <div class="result-title" title="${esc(video.title)}">${esc(video.title)}</div>
        <div class="result-meta">
          <span class="result-author">${esc(video.author || '')}</span>
          <span class="result-views">${views} views</span>
        </div>
      </div>
      <div class="result-actions">
        <button class="play-btn" data-action="play">▶ Play</button>
        <button data-action="queue">+ Queue</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const action = e.target.dataset?.action;
      if (action === 'play') {
        playVideo(video);
      } else if (action === 'queue') {
        e.stopPropagation();
        addToQueue(video);
      } else if (!e.target.closest('.result-actions')) {
        playVideo(video);
      }
    });

    return card;
  }

  // ===== Player =====
  async function playVideo(video, fromQueue = false) {
    showSection(dom.playerSection);
    dom.videoOverlay.classList.remove('hidden');
    dom.videoOverlay.innerHTML = '<div class="spinner"></div><span>Loading stream…</span>';
    dom.playerTitle.textContent = video.title || 'Unknown';
    dom.playerAuthor.textContent = video.author || video.authorName || 'Unknown';
    state.currentVideo = video;

    if (!fromQueue) {
      const existingIdx = state.queue.findIndex(v => v.videoId === video.videoId);
      if (existingIdx >= 0) {
        state.queueIndex = existingIdx;
      } else {
        state.queue.push(video);
        state.queueIndex = state.queue.length - 1;
      }
      renderQueue();
    }

    try {
      dom.videoPlayer.src = `/api/stream?id=${video.videoId}&type=video`;
      dom.audioPlayer.src = `/api/stream?id=${video.videoId}&type=audio`;

      setupMediaSession(video);

      if (state.audioMode) {
        dom.videoPlayer.pause();
        dom.videoPlayer.removeAttribute('src');
        await dom.audioPlayer.play();
      } else {
        dom.audioPlayer.pause();
        await dom.videoPlayer.play();
      }

      dom.videoOverlay.classList.add('hidden');
      state.isPlaying = true;
      updatePlayPauseIcon();

    } catch (err) {
      console.error('[YTFree] Playback error:', err);
      dom.videoOverlay.innerHTML = `
        <div style="color:#f87171;text-align:center;">
          <p style="font-size:1.2rem;margin-bottom:8px;">⚠️ Playback Error</p>
          <p style="font-size:0.85rem;opacity:0.8;">${esc(err.message)}</p>
          <p style="font-size:0.75rem;margin-top:12px;opacity:0.5;">Try another video or try again later.</p>
        </div>
      `;
    }
  }

  function getActivePlayer() {
    return state.audioMode ? dom.audioPlayer : dom.videoPlayer;
  }

  function togglePlayPause() {
    const player = getActivePlayer();
    if (player.paused) { player.play(); state.isPlaying = true; }
    else { player.pause(); state.isPlaying = false; }
    updatePlayPauseIcon();
  }

  function updatePlayPauseIcon() {
    dom.iconPlay.style.display = state.isPlaying ? 'none' : 'block';
    dom.iconPause.style.display = state.isPlaying ? 'block' : 'none';
  }

  function toggleMute() {
    const p = getActivePlayer();
    p.muted = !p.muted;
    dom.iconVol.style.display = p.muted ? 'none' : 'block';
    dom.iconMuted.style.display = p.muted ? 'block' : 'none';
  }

  function setVolume(val) { dom.videoPlayer.volume = val; dom.audioPlayer.volume = val; }

  function toggleAudioMode() {
    state.audioMode = !state.audioMode;
    dom.audioModeBtn.classList.toggle('active', state.audioMode);
    dom.videoContainer.classList.toggle('audio-mode', state.audioMode);

    if (state.currentVideo) {
      const t = getActivePlayer().currentTime;
      if (state.audioMode) {
        dom.videoPlayer.pause();
        dom.audioPlayer.currentTime = t;
        dom.audioPlayer.play();
      } else {
        dom.audioPlayer.pause();
        dom.videoPlayer.currentTime = t;
        dom.videoPlayer.play();
      }
      state.isPlaying = true;
      updatePlayPauseIcon();
    }
  }

  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (dom.videoPlayer.readyState >= 1) await dom.videoPlayer.requestPictureInPicture();
    } catch (e) { console.warn('[PiP]', e.message); }
  }

  // ===== Progress =====
  function setupPlayerListeners() {
    [dom.videoPlayer, dom.audioPlayer].forEach(player => {
      player.addEventListener('timeupdate', () => {
        if (player !== getActivePlayer()) return;
        const pct = (player.currentTime / player.duration) * 100 || 0;
        dom.progressSlider.value = pct;
        dom.timeCurrent.textContent = formatTime(player.currentTime);
      });
      player.addEventListener('loadedmetadata', () => {
        dom.timeTotal.textContent = formatTime(player.duration);
      });
      player.addEventListener('ended', () => {
        if (player === getActivePlayer()) playNext();
      });
      player.addEventListener('play', () => {
        if (player === getActivePlayer()) { state.isPlaying = true; updatePlayPauseIcon(); }
      });
      player.addEventListener('pause', () => {
        if (player === getActivePlayer()) { state.isPlaying = false; updatePlayPauseIcon(); }
      });
    });

    dom.progressSlider.addEventListener('input', () => {
      const p = getActivePlayer();
      if (p.duration) p.currentTime = (dom.progressSlider.value / 100) * p.duration;
    });
    dom.volumeSlider.addEventListener('input', () => setVolume(parseFloat(dom.volumeSlider.value)));
  }

  // ===== Queue =====
  function addToQueue(video) {
    if (state.queue.some(v => v.videoId === video.videoId)) return;
    state.queue.push(video);
    renderQueue();
    showToast(`Added: ${video.title}`);
  }

  function removeFromQueue(i) {
    state.queue.splice(i, 1);
    if (state.queueIndex >= state.queue.length) state.queueIndex = state.queue.length - 1;
    renderQueue();
  }

  function clearQueue() { state.queue = []; state.queueIndex = -1; renderQueue(); }
  function playNext() { if (state.queueIndex < state.queue.length - 1) { state.queueIndex++; playVideo(state.queue[state.queueIndex], true); } }
  function playPrev() { if (state.queueIndex > 0) { state.queueIndex--; playVideo(state.queue[state.queueIndex], true); } }

  function renderQueue() {
    const count = state.queue.length;
    dom.queueBadge.style.display = count > 0 ? 'flex' : 'none';
    dom.queueBadge.textContent = count;

    if (count === 0) {
      dom.queueList.innerHTML = '<div class="queue-empty"><p>Your queue is empty.</p><p class="queue-hint">Search for videos and add them here.</p></div>';
      return;
    }

    dom.queueList.innerHTML = '';
    state.queue.forEach((video, i) => {
      const item = document.createElement('div');
      item.className = `queue-item${i === state.queueIndex ? ' active' : ''}`;
      const thumbUrl = getBestThumb(video);
      item.innerHTML = `
        <div class="queue-item-thumb"><img src="${thumbUrl}" alt="" loading="lazy"></div>
        <div class="queue-item-info">
          <div class="queue-item-title" title="${esc(video.title)}">${esc(video.title)}</div>
          <div class="queue-item-author">${esc(video.author || '')}</div>
        </div>
        <button class="queue-item-remove" data-index="${i}" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.queue-item-remove')) { removeFromQueue(i); return; }
        state.queueIndex = i; playVideo(video, true);
      });
      dom.queueList.appendChild(item);
    });
  }

  function toggleQueue() { document.body.classList.toggle('queue-open'); }

  // ===== Auth =====
  async function checkAuth() {
    try {
      const data = await api('/auth/status');
      state.oauthAvailable = data.oauthAvailable;

      if (data.loggedIn && data.user) {
        state.user = data.user;
        dom.loginBtn.style.display = 'none';
        dom.userBtn.style.display = 'block';
        dom.userAvatar.src = data.user.picture || '';
        dom.dropdownAvatar.src = data.user.picture || '';
        dom.dropdownName.textContent = data.user.name || '';
        dom.dropdownEmail.textContent = data.user.email || '';
      } else {
        state.user = null;
        dom.loginBtn.style.display = state.oauthAvailable ? 'inline-flex' : 'none';
        dom.userBtn.style.display = 'none';
      }
    } catch (e) {
      console.warn('[Auth] Status check failed:', e.message);
    }
  }

  function startLogin() {
    window.location.href = '/auth/google';
  }

  async function doLogout() {
    await api('/auth/logout');
    state.user = null;
    dom.loginBtn.style.display = state.oauthAvailable ? 'inline-flex' : 'none';
    dom.userBtn.style.display = 'none';
    dom.userDropdown.style.display = 'none';
    showToast('Signed out');
  }

  function toggleUserDropdown() {
    const dd = dom.userDropdown;
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-btn') && !e.target.closest('#user-dropdown')) {
      dom.userDropdown.style.display = 'none';
    }
  });

  // ===== Library =====
  function showLibrary() {
    showSection(dom.librarySection);
    if (state.user) {
      dom.libraryLoginPrompt.style.display = 'none';
      dom.libraryContent.style.display = 'block';
      loadLibraryTab(state.currentLibraryTab);
    } else {
      dom.libraryLoginPrompt.style.display = 'block';
      dom.libraryContent.style.display = 'none';
      dom.oauthNotConfigured.style.display = state.oauthAvailable ? 'none' : 'block';
    }
  }

  async function loadLibraryTab(tab) {
    state.currentLibraryTab = tab;
    $$('.lib-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    dom.libraryGrid.innerHTML = '';
    dom.libraryError.style.display = 'none';
    dom.libraryLoading.style.display = 'flex';

    try {
      if (tab === 'playlists') {
        const data = await api('/api/my/playlists');
        dom.libraryLoading.style.display = 'none';
        if (!data.items?.length) {
          dom.libraryGrid.innerHTML = '<div class="queue-empty"><p>No playlists found.</p></div>';
          return;
        }
        data.items.forEach(pl => {
          dom.libraryGrid.appendChild(createPlaylistCard(pl));
        });

      } else if (tab === 'liked') {
        const data = await api('/api/my/liked');
        dom.libraryLoading.style.display = 'none';
        if (!data.items?.length) {
          dom.libraryGrid.innerHTML = '<div class="queue-empty"><p>No liked videos found.</p></div>';
          return;
        }
        data.items.forEach((item, i) => {
          const video = ytDataToVideo(item);
          dom.libraryGrid.appendChild(createResultCard(video, i));
        });

      } else if (tab === 'subscriptions') {
        const data = await api('/api/my/subscriptions');
        dom.libraryLoading.style.display = 'none';
        if (!data.items?.length) {
          dom.libraryGrid.innerHTML = '<div class="queue-empty"><p>No subscriptions found.</p></div>';
          return;
        }
        data.items.forEach(sub => {
          dom.libraryGrid.appendChild(createSubCard(sub));
        });
      }
    } catch (err) {
      dom.libraryLoading.style.display = 'none';
      dom.libraryError.textContent = err.message;
      dom.libraryError.style.display = 'block';
    }
  }

  function createPlaylistCard(pl) {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    const thumb = pl.snippet?.thumbnails?.medium?.url || pl.snippet?.thumbnails?.default?.url || '';
    const count = pl.contentDetails?.itemCount || 0;

    card.innerHTML = `
      <div class="playlist-card-thumb">
        <img src="${thumb}" alt="" loading="lazy">
        <div class="playlist-card-count">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          ${count} videos
        </div>
      </div>
      <div class="playlist-card-info">
        <div class="playlist-card-title" title="${esc(pl.snippet?.title || '')}">${esc(pl.snippet?.title || 'Untitled Playlist')}</div>
        <div class="playlist-card-meta">${esc(pl.snippet?.channelTitle || '')}</div>
      </div>
    `;
    card.addEventListener('click', () => openPlaylist(pl.id, pl.snippet?.title || 'Playlist'));
    return card;
  }

  function createSubCard(sub) {
    const card = document.createElement('div');
    card.className = 'sub-card';
    const thumb = sub.snippet?.thumbnails?.default?.url || '';
    const name = sub.snippet?.title || 'Unknown';
    const channelId = sub.snippet?.resourceId?.channelId || '';

    card.innerHTML = `
      <img src="${thumb}" alt="" loading="lazy">
      <div>
        <div class="sub-card-name">${esc(name)}</div>
        <div class="sub-card-id">${esc(channelId)}</div>
      </div>
    `;
    card.addEventListener('click', () => searchChannelVideos(name));
    return card;
  }

  function searchChannelVideos(channelName) {
    dom.searchInput.value = channelName;
    performSearch();
  }

  async function openPlaylist(playlistId, title) {
    showSection(dom.playlistDetailSection);
    dom.playlistDetailTitle.textContent = title;
    dom.playlistDetailCount.textContent = '';
    dom.playlistDetailGrid.innerHTML = '';
    dom.playlistDetailLoading.style.display = 'flex';
    state.currentPlaylistItems = [];
    state.currentPlaylistId = playlistId;

    try {
      const data = await api(`/api/my/playlist/${playlistId}`);
      dom.playlistDetailLoading.style.display = 'none';

      if (!data.items?.length) {
        dom.playlistDetailGrid.innerHTML = '<div class="queue-empty"><p>This playlist is empty.</p></div>';
        return;
      }

      dom.playlistDetailCount.textContent = `${data.items.length} videos`;
      state.currentPlaylistItems = data.items.map(ytDataToVideo);

      state.currentPlaylistItems.forEach((video, i) => {
        dom.playlistDetailGrid.appendChild(createResultCard(video, i));
      });
    } catch (err) {
      dom.playlistDetailLoading.style.display = 'none';
      dom.playlistDetailGrid.innerHTML = `<div class="error-message">${esc(err.message)}</div>`;
    }
  }

  function playAllPlaylist() {
    if (!state.currentPlaylistItems.length) return;
    state.queue = [...state.currentPlaylistItems];
    state.queueIndex = 0;
    renderQueue();
    playVideo(state.queue[0], true);
    showToast(`Playing ${state.queue.length} videos`);
  }

  // Convert YouTube Data API item to an internal video object
  function ytDataToVideo(item) {
    const snippet = item.snippet || {};
    const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId || item.id || '';
    return {
      type: 'video',
      videoId,
      title: snippet.title || 'Unknown',
      author: snippet.channelTitle || snippet.videoOwnerChannelTitle || '',
      authorName: snippet.channelTitle || '',
      lengthSeconds: 0, // Not available from list endpoints
      viewCount: 0,
      videoThumbnails: [
        { url: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '', quality: 'high' },
      ],
    };
  }

  // ===== Media Session =====
  function setupMediaSession(video) {
    if (!('mediaSession' in navigator)) return;
    const thumb = getBestThumb(video);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title || 'Unknown',
      artist: video.author || '',
      album: 'YTFree',
      artwork: thumb ? [{ src: thumb, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    navigator.mediaSession.setActionHandler('seekbackward', (d) => { getActivePlayer().currentTime = Math.max(0, getActivePlayer().currentTime - (d.seekOffset || 10)); });
    navigator.mediaSession.setActionHandler('seekforward', (d) => { getActivePlayer().currentTime = Math.min(getActivePlayer().duration, getActivePlayer().currentTime + (d.seekOffset || 10)); });
  }

  // ===== Toast =====
  function showToast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);
      background:rgba(124,58,237,0.9);color:#fff;padding:10px 20px;border-radius:999px;
      font-size:0.82rem;font-family:var(--font);font-weight:500;z-index:999;
      backdrop-filter:blur(8px);box-shadow:0 4px 20px rgba(0,0,0,0.3);opacity:0;
      transition:all 0.3s ease;max-width:90vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 2500);
  }

  // ===== Utilities =====
  function getBestThumb(video) {
    if (video.videoThumbnails?.length) {
      const t = video.videoThumbnails.find(t => t.quality === 'medium' || t.quality === 'high') || video.videoThumbnails[0];
      return t.url || '';
    }
    return '';
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function formatViews(count) {
    if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
    if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
    if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
    return count.toString();
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ===== Keyboard Shortcuts =====
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Enter' && e.target === dom.searchInput) performSearch();
      return;
    }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlayPause(); break;
      case 'ArrowRight': e.preventDefault(); getActivePlayer().currentTime += 5; break;
      case 'ArrowLeft': e.preventDefault(); getActivePlayer().currentTime -= 5; break;
      case 'n': playNext(); break;
      case 'p': playPrev(); break;
      case 'm': toggleMute(); break;
      case 'a': toggleAudioMode(); break;
      case 'q': toggleQueue(); break;
      case '/': e.preventDefault(); dom.searchInput.focus(); break;
    }
  });

  // ===== Init =====
  function init() {
    dom.searchBtn.addEventListener('click', performSearch);
    dom.playPauseBtn.addEventListener('click', togglePlayPause);
    dom.prevBtn.addEventListener('click', playPrev);
    dom.nextBtn.addEventListener('click', playNext);
    dom.muteBtn.addEventListener('click', toggleMute);
    dom.audioModeBtn.addEventListener('click', toggleAudioMode);
    dom.pipBtn.addEventListener('click', togglePiP);
    dom.toggleQueueBtn.addEventListener('click', toggleQueue);
    dom.closeQueueBtn.addEventListener('click', toggleQueue);
    dom.clearQueueBtn.addEventListener('click', clearQueue);
    dom.toggleLibraryBtn.addEventListener('click', showLibrary);

    // iOS Background Playback Auto-Audio Mode
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.isPlaying && !state.audioMode) {
        showToast('Background Play: Audio Mode Auto-Enabled');
        toggleAudioMode();
      }
    });

    // Auth
    dom.loginBtn.addEventListener('click', startLogin);
    dom.libraryLoginBtn.addEventListener('click', startLogin);
    dom.userBtn.addEventListener('click', toggleUserDropdown);
    dom.logoutBtn.addEventListener('click', doLogout);

    // Library tabs
    $$('.lib-tab').forEach(tab => {
      tab.addEventListener('click', () => loadLibraryTab(tab.dataset.tab));
    });

    // Playlist detail
    dom.playlistBackBtn.addEventListener('click', showLibrary);
    dom.playAllBtn.addEventListener('click', playAllPlaylist);

    // Logo → welcome
    $('#logo-btn').addEventListener('click', () => showSection(dom.welcomeSection));

    setVolume(0.8);
    setupPlayerListeners();
    checkAuth();

    // Handle login redirect
    if (window.location.search.includes('loggedIn=1')) {
      history.replaceState({}, '', '/');
      checkAuth().then(() => {
        showToast(`Welcome, ${state.user?.name || 'User'}!`);
      });
    }

    console.log('[YTFree] App initialized');
  }

  init();
})();
