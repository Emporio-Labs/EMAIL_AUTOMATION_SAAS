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

export function rewriteLinks(html: string, jobId: string, baseUrl: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (tagMatch, attributes) => {
    const hrefRegex = /href=(["'])(.*?)\1/i;
    const hrefMatch = attributes.match(hrefRegex);
    if (!hrefMatch) {
      return tagMatch;
    }
    const quote = hrefMatch[1];
    const originalUrl = hrefMatch[2];
    
    const lowerUrl = originalUrl.toLowerCase();
    if (lowerUrl.startsWith('mailto:') || lowerUrl.includes('/unsubscribe') || lowerUrl.includes('/unsub')) {
      return tagMatch;
    }

    const encoded = toBase64Url(originalUrl);
    const trackingUrl = `${baseUrl}/t/c/${jobId}/${encoded}`;
    const newAttributes = attributes.replace(hrefRegex, `href=${quote}${trackingUrl}${quote}`);
    return `<a${newAttributes}>`;
  });
}
