import { useState, useCallback, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface LoadedImage {
  original: HTMLImageElement;
  processed: HTMLImageElement;
  originalBitDepth: number;
}

const detectBitDepth = async (file: File): Promise<number> => {
  // Default to 8-bit if detection fails or format is unsupported
  const fallbackDepth = 8;

  if (!file.type.includes('png')) {
    return fallbackDepth;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      if (!(buffer instanceof ArrayBuffer)) {
        resolve(fallbackDepth);
        return;
      }

      const view = new DataView(buffer);
      // PNG signature 8 bytes: 137 80 78 71 13 10 26 10
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < signature.length; i++) {
        if (view.getUint8(i) !== signature[i]) {
          resolve(fallbackDepth);
          return;
        }
      }

      // IHDR chunk starts at byte 8, bit depth stored at byte 24
      const bitDepth = view.byteLength > 24 ? view.getUint8(24) : fallbackDepth;
      // Clamp to a sensible range we support
      resolve(Math.max(1, Math.min(16, bitDepth)));
    };
    reader.onerror = () => resolve(fallbackDepth);
    reader.readAsArrayBuffer(file);
  });
};

const chooseOverlayColor = (pixels: Uint8ClampedArray) => {
  // Compute average color of the processed image
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const total = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    rSum += pixels[i];
    gSum += pixels[i + 1];
    bSum += pixels[i + 2];
  }

  const avg = [rSum / total, gSum / total, bSum / total];
  const candidates: Array<[number, number, number]> = [
    [255, 215, 0],  // yellow
    [255, 0, 255],  // magenta
    [0, 255, 255],  // cyan
  ];

  let best = candidates[0];
  let bestDist = -1;
  for (const c of candidates) {
    const dist =
      Math.pow(c[0] - avg[0], 2) +
      Math.pow(c[1] - avg[1], 2) +
      Math.pow(c[2] - avg[2], 2);
    if (dist > bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best;
};

export const BitDepthVisualizer = () => {
  const [imageData, setImageData] = useState<LoadedImage | null>(null);
  const [bitDepth, setBitDepth] = useState([8]);
  const [histogram, setHistogram] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);

  const calculateHistogram = useCallback((imgData: LoadedImage, currentBitDepth: number[]) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure original preview is drawn (left panel)
    if (originalCanvasRef.current) {
      const oCanvas = originalCanvasRef.current;
      const oCtx = oCanvas.getContext('2d');
      if (oCtx) {
        oCanvas.width = imgData.original.width;
        oCanvas.height = imgData.original.height;
        oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);
        oCtx.drawImage(imgData.original, 0, 0);
        // Set CSS size for responsive display
        oCanvas.style.width = '100%';
        oCanvas.style.height = 'auto';
      }
    }

    // Prepare processed canvas (right panel)
    canvas.width = imgData.original.width;
    canvas.height = imgData.original.height;
    
    // Clear and draw original image first
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgData.original, 0, 0);
    
    // Set CSS size for responsive display
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    const origPixels = new Uint8ClampedArray(pixels);
    const width = canvas.width;
    const height = canvas.height;
    const lumOrig = new Float32Array(width * height);
    const lumProc = new Float32Array(width * height);
    const bucketIdx = new Uint16Array(width * height);

    // Apply bit depth reduction only when reducing; otherwise keep original pixels
    const reducing = currentBitDepth[0] < imgData.originalBitDepth;
    const levels = Math.pow(2, currentBitDepth[0]);
    const step = 256 / levels;
    
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      
      // Original luminance
      const luminosity = 0.299 * r + 0.587 * g + 0.114 * b;
      lumOrig[i / 4] = luminosity;

      if (reducing) {
        // Quantize only when reducing
        const quantized = Math.floor(luminosity / step) * step;
        const bucket = Math.floor(luminosity / step);
        const factor = quantized / luminosity || 0;
        pixels[i] = Math.min(255, r * factor);
        pixels[i + 1] = Math.min(255, g * factor);
        pixels[i + 2] = Math.min(255, b * factor);
        lumProc[i / 4] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        bucketIdx[i / 4] = bucket;
      } else {
        // No reduction: keep original
        lumProc[i / 4] = luminosity;
        bucketIdx[i / 4] = Math.floor(luminosity / step);
      }
    }
    
    ctx.putImageData(data, 0, 0);

    // Compute histogram from quantized pixels BEFORE edge overlay is blended in
    const hist = new Array(256).fill(0);
    for (let i = 0; i < pixels.length; i += 4) {
      const luminosity = Math.floor(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
      hist[luminosity]++;
    }

    if (showEdges && reducing) {
      // Sobel per-channel on original and processed, then max-combine and subtract
      const sobel = (arr: Float32Array) => {
        const out = new Float32Array(width * height);
        let maxVal = 0;
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const a00 = arr[idx - width - 1];
            const a01 = arr[idx - width];
            const a02 = arr[idx - width + 1];
            const a10 = arr[idx - 1];
            const a12 = arr[idx + 1];
            const a20 = arr[idx + width - 1];
            const a21 = arr[idx + width];
            const a22 = arr[idx + width + 1];
            const gx = -a00 - 2 * a10 - a20 + a02 + 2 * a12 + a22;
            const gy = -a00 - 2 * a01 - a02 + a20 + 2 * a21 + a22;
            const mag = Math.abs(gx) + Math.abs(gy);
            out[idx] = mag;
            if (mag > maxVal) maxVal = mag;
          }
        }
        return { out, maxVal };
      };

      // Build per-channel arrays for original and processed
      const chanOrig = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)];
      const chanProc = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)];
      for (let i = 0; i < pixels.length; i += 4) {
        const idx = i / 4;
        chanProc[0][idx] = pixels[i];
        chanProc[1][idx] = pixels[i + 1];
        chanProc[2][idx] = pixels[i + 2];
      }
      // Original pixels captured before quantization
      for (let i = 0; i < origPixels.length; i += 4) {
        const idx = i / 4;
        chanOrig[0][idx] = origPixels[i];
        chanOrig[1][idx] = origPixels[i + 1];
        chanOrig[2][idx] = origPixels[i + 2];
      }

      // Sobel per channel, take max combine
      const sobelOrigR = sobel(chanOrig[0]);
      const sobelOrigG = sobel(chanOrig[1]);
      const sobelOrigB = sobel(chanOrig[2]);
      const sobelProcR = sobel(chanProc[0]);
      const sobelProcG = sobel(chanProc[1]);
      const sobelProcB = sobel(chanProc[2]);

      const diffMag = new Float32Array(width * height);
      let maxDiff = 0;
      for (let i = 0; i < diffMag.length; i++) {
        const origMax = Math.max(sobelOrigR.out[i], sobelOrigG.out[i], sobelOrigB.out[i]);
        const procMax = Math.max(sobelProcR.out[i], sobelProcG.out[i], sobelProcB.out[i]);
        const d = Math.max(0, procMax - origMax);
        diffMag[i] = d;
        if (d > maxDiff) maxDiff = d;
      }

      // Bucket-change mask
      const bucketMask = new Uint8Array(width * height);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const b = bucketIdx[idx];
          if (
            bucketIdx[idx - 1] !== b ||
            bucketIdx[idx + 1] !== b ||
            bucketIdx[idx - width] !== b ||
            bucketIdx[idx + width] !== b
          ) {
            bucketMask[idx] = 1;
          }
        }
      }

      const overlayColor = chooseOverlayColor(pixels);
      const alpha = 0.6;
      const threshold = maxDiff * 0.2; // raise threshold to catch less

      const dilated = new Uint8Array(width * height);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (bucketMask[idx] && diffMag[idx] >= threshold && threshold > 0) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                dilated[idx + dy * width + dx] = 1;
              }
            }
          }
        }
      }

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (dilated[idx]) {
            const p = idx * 4;
            pixels[p] = pixels[p] * (1 - alpha) + overlayColor[0] * alpha;
            pixels[p + 1] = pixels[p + 1] * (1 - alpha) + overlayColor[1] * alpha;
            pixels[p + 2] = pixels[p + 2] * (1 - alpha) + overlayColor[2] * alpha;
          }
        }
      }

      ctx.putImageData(data, 0, 0);
    }

    setHistogram(hist);
  }, [showEdges]);

  const processImage = useCallback(async (file: File) => {
    const detectedDepth = await detectBitDepth(file);

    const blobUrl = URL.createObjectURL(file);
    const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(err);
      };
      img.src = blobUrl;
    });

    try {
      const img = await imagePromise;

      setImageData({
        original: img,
        processed: img,
        originalBitDepth: detectedDepth
      });
      
      setBitDepth([detectedDepth]);
      
      // Draw original image
      if (originalCanvasRef.current) {
        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Set canvas size
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Clear and draw
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          
          // Set CSS size for responsive display
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
        }
      }
      
      toast.success('Image loaded successfully!');
    } catch (error) {
      toast.error('Failed to load image');
    }
  }, []);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processImage(file);
    } else {
      toast.error('Please upload a valid image file');
    }
  }, [processImage]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      await processImage(file);
    } else {
      toast.error('Please upload a valid image file');
    }
  }, [processImage]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleReset = useCallback(() => {
    setImageData(null);
    setBitDepth([8]);
    setHistogram([]);
  }, []);

  const downloadProcessed = useCallback(() => {
    if (!canvasRef.current) return;
    
    const link = document.createElement('a');
    link.download = `processed-${bitDepth[0]}bit.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
    
    toast.success('Image downloaded!');
  }, [bitDepth]);

  useEffect(() => {
    if (imageData) {
      calculateHistogram(imageData, bitDepth);
    }
  }, [imageData, bitDepth, calculateHistogram]);

  return (
    <div className="min-h-screen bg-technical-bg flex flex-col">
      <header className="shrink-0 border-b bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Capstone
          </a>
        </div>
      </header>
      <div className="flex-1 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Bit Depth Visualizer
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explore how bit depth affects image quality through quantization error and color banding visualization
          </p>
        </div>

        {/* Upload Area */}
        {!imageData && (
          <Card className="bg-technical-surface border-technical-border">
            <div
              className={`p-12 border-2 border-dashed rounded-lg transition-all ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-technical-border hover:border-primary/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="text-center space-y-4">
                <Upload className="w-12 h-12 text-muted-foreground mx-auto" />
                <div>
                  <p className="text-lg font-medium">Upload an image to analyze</p>
                  <p className="text-sm text-muted-foreground">
                    Drag & drop or click to select (PNG, JPG, WEBP)
                  </p>
                </div>
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-gradient-primary hover:shadow-glow transition-all"
                >
                  Choose File
                </Button>
              </div>
            </div>
          </Card>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />

        {imageData && (
          <>
            {/* Controls */}
            <Card className="bg-technical-surface border-technical-border p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1 mr-8">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Bit Depth: {bitDepth[0]} bits ({Math.pow(2, bitDepth[0])} levels)
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="show-edges"
                          checked={showEdges}
                          onCheckedChange={(checked) => setShowEdges(Boolean(checked))}
                          className="border-technical-border data-[state=checked]:bg-primary"
                        />
                        <label htmlFor="show-edges" className="text-sm text-muted-foreground">
                          Show band edges
                        </label>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReset}
                        className="border-technical-border hover:bg-technical-border"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Reset
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadProcessed}
                        className="border-technical-border hover:bg-technical-border"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                  <Slider
                    value={bitDepth}
                    onValueChange={setBitDepth}
                    min={1}
                    max={Math.min(16, imageData.originalBitDepth)}
                    step={1}
                    className="w-full"
                    onDoubleClick={() => setBitDepth([imageData?.originalBitDepth ?? 8])}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 bit (2 levels)</span>
                    <span>{Math.min(16, imageData.originalBitDepth)} bits ({Math.pow(2, Math.min(16, imageData.originalBitDepth))} levels)</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Image Comparison */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="bg-technical-surface border-technical-border p-6">
                <h3 className="text-lg font-semibold mb-4">Original ({imageData.originalBitDepth}-bit)</h3>
                <div className="bg-technical-bg rounded-lg p-4 overflow-hidden">
                  <canvas
                    ref={originalCanvasRef}
                    className="max-w-full h-auto rounded border border-technical-border block"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </div>
              </Card>

              <Card className="bg-technical-surface border-technical-border p-6">
                <h3 className="text-lg font-semibold mb-4">
                  Processed ({bitDepth[0]}-bit)
                </h3>
                <div className="bg-technical-bg rounded-lg p-4 overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    className="max-w-full h-auto rounded border border-technical-border block"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </div>
              </Card>
            </div>

            {/* Histogram */}
            {histogram.length > 0 && (
              <Card className="bg-technical-surface border-technical-border p-6">
                <h3 className="text-lg font-semibold mb-4">Luminosity Histogram</h3>
                <div className="bg-technical-bg rounded-lg p-4">
                  <div className="flex items-end h-32 gap-px">
                    {histogram.map((count, index) => {
                      const height = Math.max(1, (count / Math.max(...histogram)) * 100);
                      return (
                        <div
                          key={index}
                          className="bg-primary/70 min-w-px flex-1"
                          style={{ height: `${height}%` }}
                          title={`Level ${index}: ${count} pixels`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>0 (Black)</span>
                    <span>255 (White)</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Narrow peaks indicate quantization buckets at {bitDepth[0]}-bit depth
                  </p>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
};