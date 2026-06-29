const URL_RE = /(https?:\/\/[^\s<>"']+)/i;

function extractFirstUrl(text) {
  const match = text.match(URL_RE);
  return match ? match[1] : null;
}

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

// Best-effort: funktioniert nur, wenn der jeweilige PC Internetzugang hat.
// Schlägt das fehl (kein Internet, Timeout, kein HTML), wird einfach keine Vorschau angezeigt.
async function fetchLinkPreview(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let received = 0;
    while (received < 150000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      received += value.length;
    }
    reader.cancel();

    const title = extractMeta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const image = extractMeta(html, 'og:image');

    if (!title && !description && !image) return null;

    return {
      url,
      title: (title || url).trim(),
      description: description ? description.trim() : '',
      image: image || null,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { extractFirstUrl, fetchLinkPreview };
