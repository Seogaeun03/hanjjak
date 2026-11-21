const images = new Map<string, Promise<HTMLImageElement>>();

/**
 * 치장 그림은 주소마다 한 번만 받아 디코딩해 둔다. `<img src>`를 프레임마다 갈아 끼우면
 * 캐시가 만료된 뒤 브라우저가 부위마다 다시 확인하러 간다.
 * 받아 둔 이미지를 캔버스에 그리면 첫 로딩 이후로는 요청이 나가지 않는다.
 */
export function loadCosmeticImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`치장 이미지 로드 실패: ${url}`));
      image.src = url;
    });
    // 실패한 주소는 캐시에서 빼서 다음 프레임에 다시 받을 수 있게 한다.
    pending.catch(() => images.delete(url));
    images.set(url, pending);
  }
  return pending;
}
