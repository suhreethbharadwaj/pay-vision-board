import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, CheckCircle, XCircle, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useFaceDetection } from '@/hooks/useFaceDetection';
import { toast } from 'sonner';

interface FaceVerificationProps {
  rfidTag: string;
  onVerified: (userId: string) => void;
  onFailed: () => void;
}

export const FaceVerification = ({ rfidTag, onVerified, onFailed }: FaceVerificationProps) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [faceDetected, setFaceDetected] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { detectFaces, extractFaceEmbedding, compareFaces, drawDetections, isLoading: detectorLoading } = useFaceDetection();

  useEffect(() => {
    startVerification();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.crossOrigin = 'anonymous';
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        
        // Wait for video to have actual dimensions
        await new Promise<void>((resolve) => {
          const checkVideo = setInterval(() => {
            if (videoRef.current && videoRef.current.videoWidth > 0) {
              clearInterval(checkVideo);
              console.log('✅ Camera ready:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
              resolve();
            }
          }, 100);
        });
      }
      setStream(mediaStream);
    } catch (err) {
      console.error('Error accessing camera:', err);
      toast.error('Camera access failed');
      onFailed();
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const startVerification = async () => {
    await startCamera();
    setIsVerifying(true);
    
    // Start visual debugging overlay
    startVisualDebug();
    
    // Wait for camera and face detector to fully initialize (longer delay)
    setTimeout(() => {
      verifyFace();
    }, 3500);
  };

  const startVisualDebug = () => {
    const interval = setInterval(() => {
      if (videoRef.current && canvasRef.current && verificationStatus === 'idle') {
        drawDetections(videoRef.current, canvasRef.current);
      } else {
        clearInterval(interval);
      }
    }, 100);
  };

  const verifyFace = async () => {
    if (!videoRef.current) {
      onFailed();
      return;
    }

    try {
      console.log('🔍 Verification - Looking for RFID Tag:', rfidTag);
      
      // Get user's stored face data (support both face_embedding and face_image_url)
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name, face_embedding, face_image_url')
        .eq('id', rfidTag)
        .maybeSingle();

      console.log('👤 Verification - User found:', user);
      console.log('🔐 Verification - Has face_embedding:', !!user?.face_embedding);
      console.log('🖼️ Verification - Has face_image_url:', !!user?.face_image_url);

      if (error || !user) {
        console.error('❌ User not found:', error);
        toast.error(`No user registered with RFID: ${rfidTag}`);
        setVerificationStatus('failed');
        setTimeout(() => {
          stopCamera();
          onFailed();
        }, 2000);
        return;
      }

      // Check if user has either face_embedding or face_image_url
      if (!user.face_embedding && !user.face_image_url) {
        console.error('❌ No face data registered');
        toast.error('No face registered. Please upload a face image to Supabase users table.');
        setVerificationStatus('failed');
        setTimeout(() => {
          stopCamera();
          onFailed();
        }, 2000);
        return;
      }

      console.log('✅ User record found:', { id: user.id, name: user.name });

      // Wait for face detector models to be ready
      if (detectorLoading) {
        console.log('⏳ Waiting for face-api.js models to load...');
        toast.info('Loading face detection models...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      if (detectorLoading) {
        console.error('❌ Models still not loaded after waiting');
        toast.error('Face detection models failed to load. Check console.');
        setVerificationStatus('failed');
        setTimeout(() => {
          stopCamera();
          onFailed();
        }, 2000);
        return;
      }

      // Ensure video is truly playing with valid frames
      console.log('📹 Video state:', {
        paused: videoRef.current.paused,
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight,
        readyState: videoRef.current.readyState
      });

      // Wait extra time for video frames to stabilize
      toast.info('Initializing camera feed...');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Retry face detection multiple times with live feedback
      let currentEmbedding = null;
      const maxRetries = 10;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔍 Face detection attempt ${attempt}/${maxRetries}`);
        console.log('🎥 Video element check:', {
          exists: !!videoRef.current,
          width: videoRef.current?.videoWidth,
          height: videoRef.current?.videoHeight,
          paused: videoRef.current?.paused
        });
        
        // Check if face is visible first
        const faces = await detectFaces(videoRef.current);
        console.log('👤 Faces detected:', faces?.length || 0);
        
        if (faces && faces.length > 0) {
          setFaceDetected(true);
          console.log('✅ Face bounding box:', faces[0].detection.box);
          toast.success(`Face found! Verifying... (${attempt}/${maxRetries})`);
        } else {
          setFaceDetected(false);
          console.log('⚠️ No faces detected in frame');
          toast.info(`Position your face clearly... (${attempt}/${maxRetries})`);
        }
        
        currentEmbedding = await extractFaceEmbedding(videoRef.current);
        
        if (currentEmbedding) {
          console.log('✅ Face detected successfully!');
          toast.success('Face detected! Verifying identity...');
          break;
        }
        
        if (attempt < maxRetries) {
          console.log('⏳ Retrying face detection...');
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
      
      if (!currentEmbedding) {
        console.error('❌ No face detected in camera');
        toast.error('No face detected. Please look directly at the camera.');
        setVerificationStatus('failed');
        setTimeout(() => {
          stopCamera();
          onFailed();
        }, 2000);
        return;
      }

      console.log('📸 Current face embedding captured:', {
        descriptorLength: currentEmbedding.descriptor.length,
        timestamp: currentEmbedding.timestamp
      });

      let storedEmbedding = user.face_embedding;

      // If no face_embedding but has face_image_url, extract embedding from image
      if (!storedEmbedding && user.face_image_url) {
        // Clean up the URL (remove extra quotes if present)
        let imageUrl = user.face_image_url.trim();
        if (imageUrl.startsWith('"') && imageUrl.endsWith('"')) {
          imageUrl = imageUrl.slice(1, -1);
        }
        
        console.log('📥 Loading face from image URL:', imageUrl);
        
        // Check if it's a valid URL (not a local file path)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          console.error('❌ Invalid image URL - must be a public URL, not a local file path');
          toast.error('Face image must be uploaded to Supabase Storage. Please upload the image to the known_faces bucket and store the public URL.');
          setVerificationStatus('failed');
          setTimeout(() => {
            stopCamera();
            onFailed();
          }, 3000);
          return;
        }
        
        toast.info('Loading registered face image...');
        
        try {
          storedEmbedding = await extractEmbeddingFromImage(imageUrl);
          if (!storedEmbedding) {
            throw new Error('Could not extract face from image');
          }
          console.log('✅ Extracted embedding from stored image');
        } catch (imgErr) {
          console.error('❌ Failed to load face from image:', imgErr);
          toast.error('Could not load face image. Please ensure it\'s a valid public URL.');
          setVerificationStatus('failed');
          setTimeout(() => {
            stopCamera();
            onFailed();
          }, 2000);
          return;
        }
      }

      // Compare embeddings
      const similarity = compareFaces(storedEmbedding as any, currentEmbedding);
      console.log('🔍 Face similarity score:', similarity);

      // Threshold for face match (less strict for better usability)
      const SIMILARITY_THRESHOLD = 0.65;

      if (similarity >= SIMILARITY_THRESHOLD) {
        console.log('✅ Face verification SUCCESS');
        setVerificationStatus('success');
        toast.success(`Welcome ${user.name}!`);
        
        // Record verification event
        await supabase.from('verification_events').insert({
          user_id: user.id,
          rfid_tag: rfidTag,
          face_verified: true,
          rfid_verified: true
        });

        setTimeout(() => {
          stopCamera();
          onVerified(user.id);
        }, 3000);
      } else {
        console.log(`❌ Face verification FAILED - similarity ${similarity.toFixed(3)} below threshold ${SIMILARITY_THRESHOLD}`);
        toast.error(`Face doesn't match. Similarity: ${(similarity * 100).toFixed(1)}%`);
        setVerificationStatus('failed');
        setTimeout(() => {
          stopCamera();
          onFailed();
        }, 3000);
      }
    } catch (err) {
      console.error('Error verifying face:', err);
      setVerificationStatus('failed');
      setTimeout(() => {
        stopCamera();
        onFailed();
      }, 2000);
    }
  };

  const extractEmbeddingFromImage = async (imageUrl: string) => {
    return new Promise<any>((resolve, reject) => {
      console.log('🖼️ Starting image load from URL:', imageUrl);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = async () => {
        console.log('✅ Image loaded successfully:', img.width, 'x', img.height);
        try {
          // Create canvas and draw image
          const canvas = document.createElement('canvas');
          const targetSize = 640; // Standard size for face detection
          const scale = Math.min(targetSize / img.width, targetSize / img.height);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          console.log('✅ Canvas created:', canvas.width, 'x', canvas.height);
          
          // Create temporary video element from canvas
          const tempVideo = document.createElement('video');
          tempVideo.width = canvas.width;
          tempVideo.height = canvas.height;
          tempVideo.autoplay = true;
          tempVideo.muted = true;
          tempVideo.playsInline = true;
          
          // Add video to DOM temporarily (required for some browsers)
          tempVideo.style.position = 'fixed';
          tempVideo.style.top = '-9999px';
          tempVideo.style.left = '-9999px';
          document.body.appendChild(tempVideo);
          
          const stream = (canvas as any).captureStream(25);
          tempVideo.srcObject = stream;
          
          console.log('⏳ Waiting for video to play...');
          await tempVideo.play();
          
          // Wait for video to be fully ready
          await new Promise(r => setTimeout(r, 500));
          
          console.log('🔍 Extracting face embedding from video...');
          // Extract embedding
          const embedding = await extractFaceEmbedding(tempVideo);
          
          console.log('📊 Embedding result:', embedding ? 'Success' : 'Failed');
          if (embedding) {
            console.log('📏 Descriptor length:', embedding.descriptor.length);
          }
          
          // Cleanup
          tempVideo.pause();
          stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
          document.body.removeChild(tempVideo);
          
          if (!embedding) {
            reject(new Error('No face detected in stored image'));
            return;
          }
          
          resolve(embedding);
        } catch (err) {
          console.error('❌ Error in extractEmbeddingFromImage:', err);
          reject(err);
        }
      };
      
      img.onerror = (e) => {
        console.error('❌ Failed to load image:', e);
        reject(new Error('Failed to load image - check CORS and URL'));
      };
      
      img.src = imageUrl;
    });
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Face Verification</h3>
        <p className="text-sm text-muted-foreground">
          {faceDetected ? '✓ Face detected - Hold still...' : 'Position your face in the oval guide'}
        </p>
      </div>

      <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          className="w-full h-full object-cover"
        />
        
        {/* Canvas overlay for face detection visualization */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        
        {/* Face guide overlay */}
        {verificationStatus === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-60 border-4 rounded-full transition-all duration-300 ${
              faceDetected ? 'border-green-500 shadow-lg shadow-green-500/50' : 'border-primary'
            }`} style={{ opacity: 0.5 }} />
            
            {/* Green checkmark indicator when face detected */}
            {faceDetected && (
              <div className="absolute top-4 right-4 bg-green-500 rounded-full p-2 animate-scale-in shadow-lg">
                <Check className="w-6 h-6 text-white" strokeWidth={3} />
              </div>
            )}
          </div>
        )}
        
        {verificationStatus !== 'idle' && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            {verificationStatus === 'success' ? (
              <div className="text-center space-y-2">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                <p className="text-lg font-semibold text-green-500">Verified!</p>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <XCircle className="w-16 h-16 text-destructive mx-auto" />
                <p className="text-lg font-semibold text-destructive">Verification Failed</p>
              </div>
            )}
          </div>
        )}
      </div>

      {isVerifying && verificationStatus === 'idle' && (
        <div className="flex justify-center">
          <div className="animate-pulse text-sm text-muted-foreground">
            Verifying your face...
          </div>
        </div>
      )}
    </Card>
  );
};
