import crypto from 'crypto';

export function toBase64Url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function fromBase64Url(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function injectTrackingPixel(html: string, jobId: string, baseUrl: string): string {
  const pixel = `<img src="${baseUrl}/t/o/${jobId}" width="1" height="1" alt="" style="display:none;" />`;
  const bodyIndex = html.toLowerCase().lastIndexOf('</body>');
  if (bodyIndex === -1) {
    return html + pixel;
  }
  return html.substring(0, bodyIndex) + pixel + html.substring(bodyIndex);
}

// Click links carry an HMAC of (jobId, url) so /t/c cannot be used as an open
// redirect to arbitrary sites.
export function signClickUrl(jobId: string, url: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${jobId}\n${url}`).digest('base64url').slice(0, 22);
}

export function verifyClickUrl(jobId: string, url: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signClickUrl(jobId, url, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function rewriteLinks(html: string, jobId: string, baseUrl: string, secret: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (tagMatch, attributes) => {
    const hrefRegex = /href=(["'])(.*?)\1/i;
    const hrefMatch = attributes.match(hrefRegex);
    if (!hrefMatch) {
      return tagMatch;
    }
    const quote = hrefMatch[1];
    const originalUrl = hrefMatch[2];
    
    const lowerUrl = originalUrl.toLowerCase();
    if (!/^https?:\/\//.test(lowerUrl)) {
      return tagMatch;
    }
    if (lowerUrl.startsWith('mailto:') || lowerUrl.includes('/unsubscribe') || lowerUrl.includes('/unsub')) {
      return tagMatch;
    }

    // hrefs are HTML-encoded; redirect to the real URL.
    const targetUrl = originalUrl.replace(/&amp;/g, '&');
    const encoded = toBase64Url(targetUrl);
    const signature = signClickUrl(jobId, targetUrl, secret);
    const trackingUrl = `${baseUrl}/t/c/${jobId}/${encoded}/${signature}`;
    const newAttributes = attributes.replace(hrefRegex, `href=${quote}${trackingUrl}${quote}`);
    return `<a${newAttributes}>`;
  });
}


export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
