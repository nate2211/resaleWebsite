"use client";

type ProgressCallback = (message: string) => void;
type PipelineCallable = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;

let textGeneratorPromise: Promise<PipelineCallable> | null = null;
let imageCaptionerPromise: Promise<PipelineCallable> | null = null;

function modelOutputText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = modelOutputText(item);
      if (text) return text;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["generated_text", "text", "caption", "summary_text"]) {
      if (typeof record[key] === "string" && record[key]) return String(record[key]).trim();
    }
  }
  return "";
}

function devicePreference() {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
}

function progressMessage(prefix: string, value: unknown) {
  if (!value || typeof value !== "object") return `${prefix}…`;
  const progress = value as { status?: string; progress?: number; file?: string };
  if (progress.status === "progress" && Number.isFinite(progress.progress)) {
    return `${prefix}… ${Math.round(progress.progress ?? 0)}%`;
  }
  if (progress.file) return `${prefix}: ${progress.file}`;
  return `${prefix}…`;
}

export async function loadBrowserTextModel(onProgress?: ProgressCallback) {
  if (!textGeneratorPromise) {
    textGeneratorPromise = (async () => {
      onProgress?.("Preparing local writing model…");
      const { env, pipeline } = await import("@huggingface/transformers");
      env.useBrowserCache = true;
      const generator = await pipeline(
        "text-generation",
        "HuggingFaceTB/SmolLM2-135M-Instruct",
        {
          device: devicePreference(),
          dtype: "q8",
          progress_callback: (progress: unknown) => onProgress?.(progressMessage("Loading writing model", progress)),
        },
      );
      onProgress?.("Writing model ready in this browser.");
      return generator as unknown as PipelineCallable;
    })().catch((error) => {
      textGeneratorPromise = null;
      throw error;
    });
  }
  return textGeneratorPromise;
}

export async function loadBrowserVisionModel(onProgress?: ProgressCallback) {
  if (!imageCaptionerPromise) {
    imageCaptionerPromise = (async () => {
      onProgress?.("Preparing local image model…");
      const { env, pipeline } = await import("@huggingface/transformers");
      env.useBrowserCache = true;
      const captioner = await pipeline(
        "image-to-text",
        "Xenova/vit-gpt2-image-captioning",
        {
          device: devicePreference(),
          dtype: "q8",
          progress_callback: (progress: unknown) => onProgress?.(progressMessage("Loading image model", progress)),
        },
      );
      onProgress?.("Image model ready in this browser.");
      return captioner as unknown as PipelineCallable;
    })().catch((error) => {
      imageCaptionerPromise = null;
      throw error;
    });
  }
  return imageCaptionerPromise;
}

export async function loadBrowserAiSuite(onProgress?: ProgressCallback) {
  const text = await loadBrowserTextModel(onProgress);
  const vision = await loadBrowserVisionModel(onProgress);
  return { text, vision, device: devicePreference() };
}

export async function generateBrowserText(
  prompt: string,
  options: { maxNewTokens?: number; temperature?: number } = {},
) {
  const generator = await loadBrowserTextModel();
  const output = await generator(prompt, {
    max_new_tokens: options.maxNewTokens ?? 260,
    temperature: options.temperature ?? 0.1,
    do_sample: false,
    return_full_text: false,
  });
  return modelOutputText(output);
}

export async function captionBrowserImage(file: File) {
  const captioner = await loadBrowserVisionModel();
  const objectUrl = URL.createObjectURL(file);
  try {
    const output = await captioner(objectUrl, { max_new_tokens: 72 });
    return modelOutputText(output);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function captionBrowserImages(files: File[], limit = 5) {
  const captions: string[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      const caption = await captionBrowserImage(file);
      if (caption) captions.push(caption);
    } catch {
      captions.push("Image caption unavailable.");
    }
  }
  return captions;
}
