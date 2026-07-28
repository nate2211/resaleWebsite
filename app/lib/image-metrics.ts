"use client";

export type ImageMathMetrics = {
  name: string;
  width: number;
  height: number;
  megapixels: number;
  brightness: number;
  contrast: number;
  saturation: number;
  edgeDensity: number;
  sharpness: number;
  dominantColor: string;
  qualityScore: number;
  histogram: number[];
  perceptualHash: string;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation: max ? delta / max : 0, value: max };
}

function colorName(r: number, g: number, b: number) {
  const { hue, saturation, value } = rgbToHsv(r, g, b);
  if (value < 0.17) return "black";
  if (saturation < 0.12 && value > 0.85) return "white";
  if (saturation < 0.16) return value < 0.48 ? "charcoal gray" : "gray";
  if (hue < 15 || hue >= 345) return value < 0.45 ? "burgundy" : "red";
  if (hue < 42) return value < 0.48 ? "brown" : "orange";
  if (hue < 68) return value < 0.55 ? "olive" : "yellow";
  if (hue < 160) return value < 0.42 ? "forest green" : "green";
  if (hue < 205) return "teal";
  if (hue < 255) return value < 0.42 ? "navy" : "blue";
  if (hue < 295) return "purple";
  if (hue < 345) return value > 0.7 ? "pink" : "magenta";
  return "multicolor";
}

async function drawableFromBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function analyzeImageBlob(blob: Blob, name = "image"): Promise<ImageMathMetrics> {
  const drawable = await drawableFromBlob(blob);
  const width = "naturalWidth" in drawable ? drawable.naturalWidth : drawable.width;
  const height = "naturalHeight" in drawable ? drawable.naturalHeight : drawable.height;
  const sampleWidth = 96;
  const sampleHeight = 96;
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas image analysis is unavailable in this browser.");
  context.drawImage(drawable as CanvasImageSource, 0, 0, sampleWidth, sampleHeight);
  if ("close" in drawable && typeof drawable.close === "function") drawable.close();
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = new Float64Array(sampleWidth * sampleHeight);
  const histogram = new Array<number>(24).fill(0);
  let brightnessSum = 0;
  let brightnessSq = 0;
  let saturationSum = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    if (pixels[i + 3] < 24) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    gray[p] = luminance;
    brightnessSum += luminance;
    brightnessSq += luminance * luminance;
    saturationSum += rgbToHsv(r, g, b).saturation;
    red += r;
    green += g;
    blue += b;
    histogram[Math.min(7, Math.floor(r / 32))] += 1;
    histogram[8 + Math.min(7, Math.floor(g / 32))] += 1;
    histogram[16 + Math.min(7, Math.floor(b / 32))] += 1;
    count += 1;
  }
  const average = count ? brightnessSum / count : 0;
  const variance = count ? Math.max(0, brightnessSq / count - average * average) : 0;
  const contrast = Math.sqrt(variance) / 128;
  let edges = 0;
  let edgeChecks = 0;
  let laplacianSum = 0;
  let laplacianSq = 0;
  let laplacianCount = 0;
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const index = y * sampleWidth + x;
      const gx = Math.abs(gray[index + 1] - gray[index - 1]);
      const gy = Math.abs(gray[index + sampleWidth] - gray[index - sampleWidth]);
      if (gx + gy > 42) edges += 1;
      edgeChecks += 1;
      const laplacian = 4 * gray[index] - gray[index - 1] - gray[index + 1]
        - gray[index - sampleWidth] - gray[index + sampleWidth];
      laplacianSum += laplacian;
      laplacianSq += laplacian * laplacian;
      laplacianCount += 1;
    }
  }
  const laplacianMean = laplacianCount ? laplacianSum / laplacianCount : 0;
  const laplacianVariance = laplacianCount
    ? Math.max(0, laplacianSq / laplacianCount - laplacianMean * laplacianMean) : 0;
  const normalizedHistogram = histogram.map((value) => count ? value / count : 0);

  const hashCanvas = document.createElement("canvas");
  hashCanvas.width = 8;
  hashCanvas.height = 8;
  const hashContext = hashCanvas.getContext("2d", { willReadFrequently: true });
  if (!hashContext) throw new Error("Canvas hash analysis is unavailable.");
  context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  hashContext.drawImage(canvas, 0, 0, 8, 8);
  const hashPixels = hashContext.getImageData(0, 0, 8, 8).data;
  const hashGray: number[] = [];
  for (let i = 0; i < hashPixels.length; i += 4) {
    hashGray.push(0.2126 * hashPixels[i] + 0.7152 * hashPixels[i + 1] + 0.0722 * hashPixels[i + 2]);
  }
  const hashAverage = hashGray.reduce((sum, value) => sum + value, 0) / Math.max(1, hashGray.length);
  const perceptualHash = hashGray.map((value) => value >= hashAverage ? "1" : "0").join("");

  const exposureScore = 1 - Math.min(1, Math.abs(average / 255 - 0.52) / 0.52);
  const resolutionScore = clamp(Math.log10(Math.max(1, width * height)) / 7);
  const sharpness = clamp(Math.log1p(laplacianVariance) / 9);
  const edgeDensity = edgeChecks ? edges / edgeChecks : 0;
  const qualityScore = Math.round(100 * clamp(
    exposureScore * 0.24 + clamp(contrast) * 0.18 + sharpness * 0.30
      + clamp(edgeDensity * 2.3) * 0.12 + resolutionScore * 0.16,
  ));
  const avgR = count ? red / count : 0;
  const avgG = count ? green / count : 0;
  const avgB = count ? blue / count : 0;

  return {
    name,
    width,
    height,
    megapixels: width * height / 1_000_000,
    brightness: average / 255,
    contrast: clamp(contrast),
    saturation: count ? saturationSum / count : 0,
    edgeDensity,
    sharpness,
    dominantColor: colorName(avgR, avgG, avgB),
    qualityScore,
    histogram: normalizedHistogram,
    perceptualHash,
  };
}

export async function analyzeImageFile(file: File) {
  return analyzeImageBlob(file, file.name);
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function hashSimilarity(a: string, b: string) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let same = 0;
  for (let i = 0; i < length; i += 1) if (a[i] === b[i]) same += 1;
  return same / length;
}

export function compareImageMetrics(a: ImageMathMetrics, b: ImageMathMetrics) {
  const histogram = cosineSimilarity(a.histogram, b.histogram);
  const hash = hashSimilarity(a.perceptualHash, b.perceptualHash);
  const edge = 1 - Math.min(1, Math.abs(a.edgeDensity - b.edgeDensity) * 4);
  const brightness = 1 - Math.min(1, Math.abs(a.brightness - b.brightness) * 2);
  const saturation = 1 - Math.min(1, Math.abs(a.saturation - b.saturation) * 2);
  return clamp(histogram * 0.34 + hash * 0.34 + edge * 0.12 + brightness * 0.10 + saturation * 0.10);
}

export async function fetchImageForMath(url: string, signal?: AbortSignal) {
  const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`, {
    cache: "force-cache",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/")) {
    throw new Error(`Image could not be read (${response.status}).`);
  }
  return response.blob();
}
