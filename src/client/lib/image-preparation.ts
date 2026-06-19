import { formatBytes } from "./format-bytes.js";

export type PreparedImage = {
  dataUrl: string;
  height: number;
  name: string;
  originalBytes: number;
  originalHeight: number;
  originalType: string;
  originalWidth: number;
  quality: number;
  size: number;
  width: number;
};

type DecodedImage = {
  close: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

const maxImageDimension = 2048;
const minImageLargestSide = 256;
const initialJpegQuality = 0.88;
const minJpegQuality = 0.62;
const jpegQualityStep = 0.08;
const preparedImageReadErrorMessage = "This browser could not read the prepared image.";

export const preparedImageMimeType = "image/jpeg";

function fitWithin(width: number, height: number, maxDimension: number): { height: number; width: number } {
  const largestSide = Math.max(width, height);

  if (largestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largestSide;

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale))
  };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a problem image file.");
  }

  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width
      };
    } catch {
      // Fall back to an HTMLImageElement because browser support varies by format.
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error("The selected image could not be decoded. Try JPG or PNG.")), {
        once: true
      });
      image.src = objectUrl;
    });

    return {
      close: () => URL.revokeObjectURL(objectUrl),
      height: loadedImage.naturalHeight,
      source: loadedImage,
      width: loadedImage.naturalWidth
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function renderJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser could not prepare the image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("This browser could not encode the image."));
          return;
        }

        resolve(blob);
      },
      preparedImageMimeType,
      quality
    );
  });
}

async function renderJpegWithinQualityBudget(
  source: CanvasImageSource,
  width: number,
  height: number,
  targetBytes: number
): Promise<{ blob: Blob; quality: number }> {
  let quality = initialJpegQuality;
  let blob = await renderJpeg(source, width, height, quality);

  while (blob.size > targetBytes && quality > minJpegQuality) {
    quality = Math.max(minJpegQuality, quality - jpegQualityStep);
    blob = await renderJpeg(source, width, height, quality);
  }

  return { blob, quality };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error(preparedImageReadErrorMessage));
        return;
      }

      resolve(reader.result);
    });
    reader.addEventListener("error", () => reject(new Error(preparedImageReadErrorMessage)));
    reader.readAsDataURL(blob);
  });
}

async function encodeJpegWithinBudget(
  decoded: DecodedImage,
  targetBytes: number
): Promise<{ blob: Blob; height: number; quality: number; width: number }> {
  let { width, height } = fitWithin(decoded.width, decoded.height, maxImageDimension);
  let { blob, quality } = await renderJpegWithinQualityBudget(decoded.source, width, height, targetBytes);

  while (blob.size > targetBytes && Math.max(width, height) > minImageLargestSide) {
    const scale = Math.max(0.5, Math.sqrt(targetBytes / blob.size) * 0.94);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const encoded = await renderJpegWithinQualityBudget(decoded.source, width, height, targetBytes);
    blob = encoded.blob;
    quality = encoded.quality;
  }

  if (blob.size > targetBytes) {
    throw new Error(`The image is still too large after resizing (${formatBytes(blob.size)}).`);
  }

  return { blob, height, quality, width };
}

export async function prepareImage(file: File, targetBytes: number): Promise<PreparedImage> {
  const decoded = await decodeImage(file);

  try {
    if (decoded.width < 1 || decoded.height < 1) {
      throw new Error("The selected image has invalid dimensions.");
    }

    const encoded = await encodeJpegWithinBudget(decoded, targetBytes);

    return {
      dataUrl: await blobToDataUrl(encoded.blob),
      height: encoded.height,
      name: file.name,
      originalBytes: file.size,
      originalHeight: decoded.height,
      originalType: file.type || "unknown",
      originalWidth: decoded.width,
      quality: encoded.quality,
      size: encoded.blob.size,
      width: encoded.width
    };
  } finally {
    decoded.close();
  }
}

export function describePreparedImage(image: PreparedImage): string {
  const converted =
    image.originalType === preparedImageMimeType &&
    image.originalWidth === image.width &&
    image.originalHeight === image.height
      ? "JPEG"
      : "normalized JPEG";

  return `${image.name}: ${image.width}x${image.height}, ${formatBytes(image.size)} ${converted}`;
}
