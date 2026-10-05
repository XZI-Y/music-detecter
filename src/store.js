'use strict';
const fs = require('node:fs');
const path = require('node:path');
const defaults = () => ({ version: 2, profile: null, settings: { count: 20, exploration: 30, syncHour: 8, background: false, startup: false, selected: [], sourceConfirmed: false, analysisStarted: false, includeLikes: false, includeRecent: false, favoritePlaylist: null, avoidKnownArtists: true, floating: false, deepAudio: true, audioBatch: 24, autoUpdate: true, installOnQuit: true, floatingMode: "dock", floatingPosition: null, repeatDays: 14, artistLimit: 1, albumLimit: 2, weights: {}, avoidTypes: {}, avoidStrength: 85, appearance: {mode:"dark",material:"smooth",hue:140,saturation:40} }, library: [], likedIds: [], playlists: [], feedback: {}, favorites: {}, blockedArtists: [], history: [], lastSync: null, warnings: [], generationNumber: 0, seenRecommendations: [], dailyUpdate: {}, analysisArchive: {}, analysisRuns: [], analysis: { metadata: 0, lyrics: 0, audio: 0, pending: 0 } });
class Store {
  constructor(dir) {
    this.file = path.join(dir, 'library.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = defaults();
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
        // An upgrade always requires the owner to confirm the new source/collection workflow.
        if (saved.version !== 2) { this.data.settings.sourceConfirmed = false; this.data.settings.selected = []; }
        this.data.version = 2;
      }
      catch { fs.copyFileSync(this.file, this.file + '.damaged-' + Date.now()); this.data.warnings = ['本地数据文件损坏，已保留备份。请重新连接账号。']; }
    }
  }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8'); fs.renameSync(tmp, this.file); }
  clear() { this.data = defaults(); this.save(); }
}
module.exports = { Store, defaults };
