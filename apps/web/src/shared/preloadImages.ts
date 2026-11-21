const images = new Map<string, HTMLImageElement>();

/** Warm the browser cache without delaying the current screen or taking foreground priority. */
export function preloadImages(urls: readonly string[]): void {
  for (const url of urls) {
    if (images.has(url)) continue;
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "low";
    images.set(url, image);
    image.onerror = () => { images.delete(url); };
    image.src = url;
    void image.decode().catch(() => undefined);
  }
}
