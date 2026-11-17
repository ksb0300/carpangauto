// 사진 줄이기 — 폰 사진(3~5MB)을 긴 변 2000px JPEG 로 (자동차등록증 글씨는 충분히 선명, 보통 300~600KB).
// 사진이 아니거나(PDF 등) 이미 작으면 그대로. 줄였는데 오히려 커지거나 못 읽는 형식이면 원본 그대로.
const 줄일형식 = /^image\/(jpeg|png|webp|heic|heif)$/i;

export async function 줄이기(file, max = 2000, quality = 0.85) {
  if (!줄일형식.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });     // 폰 사진 방향(세로·가로) 그대로
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);        // 투명 PNG 가 JPEG 에서 까맣게 되지 않게
    g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** 여러 장 한꺼번에 */
export const 모두줄이기 = files => Promise.all([...files].map(f => 줄이기(f)));
