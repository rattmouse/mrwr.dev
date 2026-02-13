export type ImageExtraction = {
  text: string;
  images: string[];
};

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function stripImagesAndCollect(input: string): ImageExtraction {
  const images: string[] = [];
  let text = input;

  const collect = (url: string) => {
    if (!url) return "";
    images.push(url);
    return "";
  };

  text = text.replace(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g, (_match, url: string) => collect(url));
  text = text.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_match, url: string) => collect(url));
  text = text.replace(/https?:\/\/github\.com\/user-attachments\/assets\/[^\s)]+/gi, (url: string) => collect(url));
  text = text.replace(
    /https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)]*)?/gi,
    (url: string) => collect(url)
  );

  return {
    text,
    images: uniq(images),
  };
}
