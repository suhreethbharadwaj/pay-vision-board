import { useEffect, useState } from 'react';
import * as faceapi from 'face-api.js';
import { toast } from 'sonner';

export interface FaceEmbedding {
  descriptor: number[];
  timestamp: number;
}

export const useFaceDetection = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      try {
        console.log('🔄 Loading face-api.js models from /models...');
        const MODEL_URL = '/models';
        
        console.log('📦 Loading TinyFaceDetector...');
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        console.log('✅ TinyFaceDetector loaded');
        
        console.log('📦 Loading FaceLandmark68Net...');
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        console.log('✅ FaceLandmark68Net loaded');
        
        console.log('📦 Loading FaceRecognitionNet...');
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        console.log('✅ FaceRecognitionNet loaded');
        
        console.log('✅ All face-api.js models loaded successfully!');
        setModelsLoaded(true);
        setIsLoading(false);
        toast.success('Face detection ready');
      } catch (err) {
        console.error('❌ Error loading face-api.js models:', err);
        console.error('❌ Error details:', JSON.stringify(err, null, 2));
        setError('Failed to load face detection models. Check console for details.');
        setIsLoading(false);
        toast.error('Failed to load face detection models');
      }
    };

    loadModels();
  }, []);

  const detectFaces = async (videoElement: HTMLVideoElement) => {
    if (!modelsLoaded) {
      console.warn('⚠️ Models not loaded yet, still loading...');
      return null;
    }
    if (!videoElement) {
      console.error('❌ Video element is null');
      return null;
    }
    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      console.error('❌ Video has no dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
      return null;
    }
    
    try {
      console.log('🔍 Attempting face detection on video:', videoElement.videoWidth, 'x', videoElement.videoHeight);
      
      const detections = await faceapi
        .detectAllFaces(videoElement, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();
      
      console.log('📊 Detection result:', detections?.length || 0, 'faces found');
      
      if (detections && detections.length > 0) {
        console.log('✅ Face bounding box:', detections[0].detection.box);
      }
      
      return detections;
    } catch (err) {
      console.error('❌ Error detecting faces:', err);
      return null;
    }
  };

  const extractFaceEmbedding = async (videoElement: HTMLVideoElement): Promise<FaceEmbedding | null> => {
    const detections = await detectFaces(videoElement);
    if (!detections || detections.length === 0) {
      console.log('❌ No faces detected for embedding extraction');
      return null;
    }

    const detection = detections[0];
    const descriptor = Array.from(detection.descriptor);
    
    console.log('✅ Face embedding extracted:', {
      descriptorLength: descriptor.length,
      confidence: detection.detection.score
    });
    
    return {
      descriptor,
      timestamp: Date.now()
    };
  };

  const compareFaces = (embedding1: FaceEmbedding, embedding2: FaceEmbedding): number => {
    const desc1 = embedding1.descriptor;
    const desc2 = embedding2.descriptor;
    
    if (desc1.length !== desc2.length) {
      console.error('❌ Descriptor length mismatch:', desc1.length, 'vs', desc2.length);
      return 0;
    }
    
    // Calculate cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < desc1.length; i++) {
      dotProduct += desc1[i] * desc2[i];
      norm1 += desc1[i] * desc1[i];
      norm2 += desc2[i] * desc2[i];
    }
    
    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);
    
    if (norm1 === 0 || norm2 === 0) return 0;
    
    const cosineSimilarity = dotProduct / (norm1 * norm2);
    
    // Convert to 0-1 range where 1 is identical
    // Cosine similarity is already -1 to 1, so normalize to 0-1
    const similarity = (cosineSimilarity + 1) / 2;
    
    console.log('🔍 Face comparison:', {
      cosineSimilarity: cosineSimilarity.toFixed(4),
      normalizedSimilarity: similarity.toFixed(4)
    });
    
    return similarity;
  };

  // Optional: Draw face detections on canvas for debugging
  const drawDetections = (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => {
    const displaySize = {
      width: videoElement.videoWidth,
      height: videoElement.videoHeight
    };
    
    faceapi.matchDimensions(canvasElement, displaySize);
    
    detectFaces(videoElement).then(detections => {
      if (!detections) return;
      
      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      const ctx = canvasElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        faceapi.draw.drawDetections(canvasElement, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvasElement, resizedDetections);
      }
    });
  };

  return {
    isLoading,
    error,
    modelsLoaded,
    detectFaces,
    extractFaceEmbedding,
    compareFaces,
    drawDetections
  };
};
