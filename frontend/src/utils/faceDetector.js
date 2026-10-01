/**
 * Face Detection & Human Face Verification Utility
 * 
 * Ensures that uploaded or camera-captured photos contain a genuine human face.
 * Uses a multi-tiered architecture:
 * 1. Native Web Shape Detection API (window.FaceDetector) when available in browser
 * 2. Google MediaPipe Tasks Vision FaceDetector (BlazeFace Short-Range model)
 * 3. Canvas Skin-Tone & Facial Geometry Heuristic Fallback
 */

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

let mediaPipeDetector = null;
let mediaPipeLoadingPromise = null;

/**
 * Initializes the MediaPipe FaceDetector instance singleton.
 */
async function getMediaPipeDetector() {
  if (mediaPipeDetector) return mediaPipeDetector;
  if (mediaPipeLoadingPromise) return mediaPipeLoadingPromise;

  mediaPipeLoadingPromise = (async () => {
    try {
      // Try local wasm first, fallback to CDN
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks('/wasm');
      } catch (wasmErr) {
        console.warn('[FaceDetector] Local wasm failed, using CDN wasm:', wasmErr);
        vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
      }

      // Try local model first, fallback to CDN
      let detector;
      const modelOptions = [
        { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'GPU' },
        { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'CPU',
        },
      ];

      for (const opt of modelOptions) {
        try {
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: opt,
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.45,
          });
          if (detector) break;
        } catch (optErr) {
          console.warn('[FaceDetector] Failed model option, trying next fallback:', opt.modelAssetPath, optErr);
        }
      }

      if (!detector) {
        throw new Error('Could not instantiate MediaPipe FaceDetector with any available option.');
      }

      mediaPipeDetector = detector;
      return detector;
    } catch (err) {
      console.error('[FaceDetector] Failed to load MediaPipe FaceDetector:', err);
      mediaPipeLoadingPromise = null;
      throw err;
    }
  })();

  return mediaPipeLoadingPromise;
}

/**
 * Loads an image from a dataUrl or File/Blob into an HTMLImageElement
 */
export function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    if (source instanceof HTMLImageElement) {
      if (source.complete && source.naturalWidth > 0) return resolve(source);
      source.onload = () => resolve(source);
      source.onerror = reject;
      return;
    }

    if (source instanceof HTMLCanvasElement) {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = source.toDataURL('image/jpeg', 0.95);
      return;
    }

    if (typeof source === 'string') {
      const img = new Image();
      if (!source.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = (err) => {
        // Fallback without crossOrigin if external URL CORS blocked
        if (img.crossOrigin) {
          const retryImg = new Image();
          retryImg.onload = () => resolve(retryImg);
          retryImg.onerror = reject;
          retryImg.src = source;
        } else {
          reject(err);
        }
      };
      img.src = source;
      return;
    }

    if (source instanceof Blob || source instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
      return;
    }

    reject(new Error('Unsupported image source type.'));
  });
}

/**
 * Fallback heuristic: analyze skin tone pixels & facial symmetry on canvas
 * Rejects solid color blocks, letters (like Google initial avatar 'K'), landscapes, icons, memes
 */
function analyzeFacialHeuristics(canvas) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let skinPixels = 0;
  let totalPixels = width * height;
  let rSum = 0, gSum = 0, bSum = 0;
  let variance = 0;

  // Track distribution across 4 quadrants to detect centered face
  let centerSkin = 0;
  let centerTotal = 0;

  const minX = Math.floor(width * 0.2);
  const maxX = Math.floor(width * 0.8);
  const minY = Math.floor(height * 0.15);
  const maxY = Math.floor(height * 0.85);

  const colors = new Map();

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      rSum += r;
      gSum += g;
      bSum += b;

      // Color quantization to detect single-color / letter graphics
      const key = `${Math.floor(r / 20)},${Math.floor(g / 20)},${Math.floor(b / 20)}`;
      colors.set(key, (colors.get(key) || 0) + 1);

      // Standard YCbCr skin tone detection
      // Y = 0.299R + 0.587G + 0.114B
      // Cb = -0.168736R - 0.331264G + 0.5B + 128
      // Cr = 0.5R - 0.418688G - 0.081312B + 128
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      const isSkin = (cb >= 77 && cb <= 127) && (cr >= 133 && cr <= 173) && (r > g) && (r > b);

      if (isSkin) {
        skinPixels++;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          centerSkin++;
        }
      }

      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        centerTotal++;
      }
    }
  }

  const sampledPixels = totalPixels / 4;
  const skinRatio = skinPixels / sampledPixels;
  const centerSkinRatio = centerSkin / (centerTotal || 1);

  // If top dominant color accounts for > 60% of pixels, it's a graphic/letter/avatar (e.g. Google 'K' avatar)
  let maxColorCount = 0;
  for (const count of colors.values()) {
    if (count > maxColorCount) maxColorCount = count;
  }
  const dominantColorRatio = maxColorCount / sampledPixels;

  if (dominantColorRatio > 0.55) {
    return {
      ok: false,
      message: 'Image appears to be a graphic or icon. Please provide a real photo of your face.',
    };
  }

  // Face should have reasonable skin ratio in the center region (between 12% and 85%)
  if (skinRatio >= 0.10 && centerSkinRatio >= 0.12 && centerSkinRatio <= 0.90) {
    return {
      ok: true,
      score: 0.8,
      message: 'Human face verified successfully! ✓',
    };
  }

  return {
    ok: false,
    message: 'No human face detected. Please ensure your face is well-lit and clearly centered.',
  };
}

/**
 * Main verification function
 * Accepts an HTMLImageElement, HTMLCanvasElement, HTMLVideoElement, dataUrl string, or Blob/File.
 * Returns: { ok: boolean, message: string, count?: number, score?: number }
 */
export async function verifyHumanFace(source) {
  try {
    const img = await loadImageElement(source);

    // Prepare a canvas for pixel analysis if needed
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(img.naturalWidth || img.width || 360, 480);
    canvas.height = Math.min(img.naturalHeight || img.height || 360, 480);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Level 1: Native window.FaceDetector (fastest, built-in to Chromium)
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        const nativeDetector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 5 });
        const faces = await nativeDetector.detect(canvas);

        if (Array.isArray(faces)) {
          if (faces.length === 1) {
            return {
              ok: true,
              count: 1,
              score: 0.95,
              message: 'Human face successfully verified! ✓',
            };
          } else if (faces.length > 1) {
            return {
              ok: false,
              count: faces.length,
              message: 'Multiple faces detected. Please upload a photo with only yourself.',
            };
          } else {
            return {
              ok: false,
              count: 0,
              message: 'No human face detected. Please upload or take a clear photo of your face.',
            };
          }
        }
      } catch (nativeErr) {
        console.warn('[FaceDetector] Native FaceDetector error, trying MediaPipe:', nativeErr);
      }
    }

    // Level 2: MediaPipe BlazeFace AI model
    try {
      const detector = await getMediaPipeDetector();
      const results = detector.detect(canvas);
      const detections = results?.detections || [];

      if (detections.length === 1) {
        const score = detections[0]?.categories?.[0]?.score || 0.9;
        if (score >= 0.45) {
          return {
            ok: true,
            count: 1,
            score,
            message: 'Human face successfully verified! ✓',
          };
        } else {
          return {
            ok: false,
            count: 0,
            score,
            message: 'Face clarity is too low. Please provide a clear, well-lit photo of your face.',
          };
        }
      } else if (detections.length > 1) {
        return {
          ok: false,
          count: detections.length,
          message: 'Multiple faces detected. Please upload a photo with only yourself.',
        };
      } else {
        return {
          ok: false,
          count: 0,
          message: 'No human face detected. Only clear human face photos are accepted.',
        };
      }
    } catch (mpErr) {
      console.warn('[FaceDetector] MediaPipe detection failed, using heuristic fallback:', mpErr);
    }

    // Level 3: Resilient heuristic fallback
    return analyzeFacialHeuristics(canvas);
  } catch (err) {
    console.error('[FaceDetector] Verification failed with error:', err);
    return {
      ok: false,
      message: 'Failed to process image. Please try uploading or taking another photo.',
    };
  }
}
