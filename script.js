const $ = (id) => document.getElementById(id);
const urlInput = $('url');
const msg = $('msg');

function show(text, isError = false) {
  msg.textContent = text;
  msg.className = 'msg' + (isError ? ' error' : '');
  msg.hidden = !text;
}

function fmtDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

$('paste').onclick = async () => {
  try {
    urlInput.value = await navigator.clipboard.readText();
  } catch {
    show('اللصق التلقائي غير مسموح، الصق الرابط يدوياً', true);
  }
};

$('fetch').onclick = async () => {
  const url = urlInput.value.trim();
  if (!url) return show('أدخل رابط الفيديو', true);
  $('result').hidden = true;
  $('fetch').disabled = true;
  show('جارٍ جلب معلومات الفيديو...');
  try {
    const r = await fetch('/api/info?url=' + encodeURIComponent(url));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'حدث خطأ');

    $('thumb').src = data.thumbnail || '';
    $('thumb').hidden = !data.thumbnail;
    $('title').textContent = data.title || '';
    $('meta').textContent = [data.uploader, fmtDuration(data.duration)].filter(Boolean).join(' • ');

    const q = $('quality');
    q.innerHTML = '<option value="best">أعلى جودة متاحة</option>';
    (data.heights || []).forEach((h) => q.add(new Option(h + 'p', h)));
    q.add(new Option('صوت فقط (MP3)', 'audio'));

    $('result').hidden = false;
    show('');
  } catch (e) {
    show(e.message, true);
  } finally {
    $('fetch').disabled = false;
  }
};

$('download').onclick = () => {
  const url = urlInput.value.trim();
  const quality = $('quality').value;
  show('جارٍ تجهيز الملف... قد يستغرق ذلك دقيقة، لا تغلق الصفحة');
  window.location.href = `/api/download?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;
};
