import { useState, useCallback, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Upload, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface LoadedImage {
  original: HTMLImageElement;
  processed: HTMLImageElement;
  originalBitDepth: number;
}

export const BitDepthVisualizer = () => {
  const [imageData, setImageData] = useState<LoadedImage | null>(null);
  const [bitDepth, setBitDepth] = useState([8]);
  const [histogram, setHistogram] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
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
    
    // Apply bit depth reduction
    const levels = Math.pow(2, currentBitDepth[0]);
    const step = 256 / levels;
    
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      
      // Calculate luminosity
      const luminosity = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // Quantize
      const quantized = Math.floor(luminosity / step) * step;
      
      // Apply quantization to RGB
      const factor = quantized / luminosity || 0;
      pixels[i] = Math.min(255, r * factor);
      pixels[i + 1] = Math.min(255, g * factor);
      pixels[i + 2] = Math.min(255, b * factor);
    }
    
    ctx.putImageData(data, 0, 0);
    
    // Calculate histogram
    const hist = new Array(256).fill(0);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const luminosity = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
      hist[luminosity]++;
    }
    
    setHistogram(hist);
  }, []);

  const processImage = useCallback((file: File) => {
    const img = new Image();
    img.onload = () => {
      // Determine original bit depth (simplified - assume 8-bit for uploaded images)
      const originalDepth = 8;
      
      setImageData({
        original: img,
        processed: img,
        originalBitDepth: originalDepth
      });
      
      setBitDepth([originalDepth]);
      
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
    };
    
    img.src = URL.createObjectURL(file);
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processImage(file);
    } else {
      toast.error('Please upload a valid image file');
    }
  }, [processImage]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processImage(file);
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
    <div className="min-h-screen bg-technical-bg p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
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
                    <div className="flex gap-2">
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
                    max={imageData.originalBitDepth}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 bit (2 levels)</span>
                    <span>{imageData.originalBitDepth} bits ({Math.pow(2, imageData.originalBitDepth)} levels)</span>
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
                  {bitDepth[0] < imageData.originalBitDepth && (
                    <span className="text-destructive ml-2">• Quantization Error Visible</span>
                  )}
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
  );
};