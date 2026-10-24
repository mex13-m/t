const express = require('express');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }));

// Only these sites are accepted
const ALLOWED = [
  /(^|\.)tiktok\.com$/,
  /(^|\.)youtube\.com$/,
  /^youtu\.be$/,
  /(^|\.)facebook\.com$/,
  /^fb\.watch$/,
];

function validUrl(u) {
  try {
    const x = new URL(u);
    return ['http:', 'https:'].includes(x.protocol) && ALLOWED.some((r) => r.test(x.hostname));
  } catch {
    return false;
  }
}

// ---- Video info ----
app.get('/api/info', (req, res) => {
  const url = String(req.query.url || '');
  if (!validUrl(url)) return res.status(400).json({ error: 'رابط غير مدعوم' });

  const p = spawn(YTDLP, ['--dump-single-json', '--no-playlist', '--no-warnings', '--', url]);
  let out = '';
  let err = '';
  const timer = setTimeout(() => p.kill('SIGKILL'), 30_000);

  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('error', () => {
    clearTimeout(timer);
    res.status(500).json({ error: 'yt-dlp غير مثبت على السيرفر' });
  });
  p.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0) {
      console.error(err);
      return res.status(422).json({ error: 'تعذر جلب الفيديو. تأكد أن الرابط عام وصحيح.' });
    }
    try {
      const j = JSON.parse(out);
      const heights = [
        ...new Set((j.formats || []).filter((f) => f.vcodec && f.vcodec !== 'none' && f.height).map((f) => f.height)),
      ].sort((a, b) => b - a);
      res.json({
        title: j.title,
        thumbnail: j.thumbnail,
        duration: j.duration,
        uploader: j.uploader,
        heights,
      });
    } catch {
      res.status(500).json({ error: 'خطأ في قراءة بيانات الفيديو' });
    }
  });
});

// ---- Download ----
app.get('/api/download', async (req, res) => {
  const url = String(req.query.url || '');
  const quality = String(req.query.quality || 'best');
  if (!validUrl(url)) return res.status(400).send('رابط غير مدعوم');

  const args = ['--no-playlist', '--no-warnings', '--windows-filenames', '--merge-output-format', 'mp4'];
  if (quality === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (/^\d{3,4}$/.test(quality)) {
    args.push('-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]`, '-S', 'res,vcodec:h264');
  } else {
    // highest quality available, prefer H.264 at the same resolution (better phone compatibility)
    args.push('-f', 'bv*+ba/b', '-S', 'res,vcodec:h264');
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vd-'));
  const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  args.push('-o', path.join(dir, '%(title).80B [%(id)s].%(ext)s'), '--', url);

  const p = spawn(YTDLP, args);
  const timer = setTimeout(() => p.kill('SIGKILL'), 10 * 60_000);
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  res.on('close', () => {
    if (p.exitCode === null) p.kill('SIGKILL');
  });
  p.on('error', () => {
    clearTimeout(timer);
    cleanup();
    if (!res.headersSent) res.status(500).send('yt-dlp غير مثبت على السيرفر');
  });
  p.on('close', async (code) => {
    clearTimeout(timer);
    if (code !== 0) {
      console.error(err);
      await cleanup();
      if (!res.headersSent) res.status(422).send('فشل التحميل');
      return;
    }
    try {
      const files = (await fs.promises.readdir(dir)).filter((f) => !f.endsWith('.part'));
      if (!files.length) throw new Error('no file');
      res.download(path.join(dir, files[0]), files[0], () => cleanup());
    } catch {
      await cleanup();
      if (!res.headersSent) res.status(500).send('لم يتم العثور على الملف');
    }
  });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
