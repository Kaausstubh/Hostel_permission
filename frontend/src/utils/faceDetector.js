/**
 * Face Detection & Human Face Verification Utility
 * 
 * Strictly validates that uploaded or camera-captured photos contain a genuine human face.
 * Rejects photos of clothing, objects, animals, cartoons, landscapes, or empty frames.
 * Uses:
 * 1. Native Web Shape Detection API (window.FaceDetector) when available in browser
 * 2. Google MediaPipe Tasks Vision BlazeFace AI model (cross-browser WebAssembly CPU)
 */

let mediaPipeDetector = null;
let mediaPipeLoadingPromise = null;

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/**
 * Initializes the MediaPipe FaceDetector instance singleton.
 * Uses CPU delegate for 100% reliability across Safari, iOS, Chrome, Firefox, and macOS.
 */
async function getMediaPipeDetector() {
  if (mediaPipeDetector) return mediaPipeDetector;
  if (mediaPipeLoadingPromise) return mediaPipeLoadingPromise;

  mediaPipeLoadingPromise = (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');

      // Initialize vision wasm fileset
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      } catch (cdnErr) {
        console.warn('[FaceDetector] CDN wasm failed, trying local fallback:', cdnErr);
        vision = await FilesetResolver.forVisionTasks('/wasm');
      }

      // Initialize FaceDetector with CPU delegate for universal compatibility
      let detector;
      try {
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_CDN,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5,
        });
      } catch (modelErr) {
        console.warn('[FaceDetector] Primary model failed, trying local fallback:', modelErr);
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/blaze_face_short_range.tflite',
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5,
        });
      }

      if (!detector) {
        throw new Error('Failed to instantiate FaceDetector model.');
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
        if (img.crossOrigin) {
          const fallback = new Image();
          fallback.onload = () => resolve(fallback);
          fallback.onerror = reject;
          fallback.src = source;
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
 * Main verification function
 * Accepts an HTMLImageElement, HTMLCanvasElement, HTMLVideoElement, dataUrl string, or Blob/File.
 * Returns: { ok: boolean, message: string, count?: number, score?: number }
 */
export async function verifyHumanFace(source) {
  try {
    const img = await loadImageElement(source);

    // Prepare a canvas for detection
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(img.naturalWidth || img.width || 480, 640);
    canvas.height = Math.min(img.naturalHeight || img.height || 480, 640);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Strategy 1: Native window.FaceDetector (fastest when available in Chromium/Android)
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
              message: 'No human face detected! Only clear human face photos are accepted for gate security records.',
            };
          }
        }
      } catch (nativeErr) {
        console.warn('[FaceDetector] Native FaceDetector error, using MediaPipe:', nativeErr);
      }
    }

    // Strategy 2: MediaPipe BlazeFace AI Model (Universal: Safari, iOS, Chrome, Firefox)
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
          message: 'Multiple faces detected. Please make sure only you are in the frame.',
        };
      } else {
        return {
          ok: false,
          count: 0,
          message: 'No human face detected! Only clear human face photos are accepted for gate security records.',
        };
      }
    } catch (mpErr) {
      console.error('[FaceDetector] MediaPipe detection failed:', mpErr);
      return {
        ok: false,
        message: 'Could not verify a human face in this photo. Please take or upload a clear photo of your face.',
      };
    }
  } catch (err) {
    console.error('[FaceDetector] Verification failed with error:', err);
    return {
      ok: false,
      message: 'Failed to process image. Please upload a clear JPG/PNG photo of your face.',
    };
  }
}
