import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function useLiveAPI(systemInstruction: string, playbackRate: number = 1) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ role: 'user' | 'ai', text: string, id: string }[]>([]);
  const [currentAiText, setCurrentAiText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Audio playback queue
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const playbackRateRef = useRef(playbackRate);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setTranscript([]);
    setIsMuted(false);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // 1. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      // 2. Setup Audio Context for recording and playback
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); // Output is 24kHz
      audioContextRef.current = audioCtx;

      // Setup recording (input is 16kHz)
      const inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = inputAudioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(inputAudioCtx.destination);

      // 3. Connect to Gemini Live API
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            // Start sending audio
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 to Int16
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              
              const base64Data = arrayBufferToBase64(pcm16.buffer);

              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setIsAiSpeaking(true);
              const buffer = base64ToArrayBuffer(base64Audio);
              const int16Array = new Int16Array(buffer);
              const float32Array = new Float32Array(int16Array.length);
              for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
              }
              
              audioQueueRef.current.push(float32Array);
              playNextAudio();
            }

            // Handle output transcription
            const aiText = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (aiText) {
              setCurrentAiText(prev => prev + aiText);
            }

            // Handle input transcription (user speech)
            const userText = message.serverContent?.inputTranscription?.text;
            if (userText) {
              setCurrentUserText(prev => prev + userText);
            }
            if (message.serverContent?.inputTranscription?.finished) {
              setCurrentUserText(prev => {
                if (prev.trim()) {
                  setTranscript(t => [...t, { role: 'user', text: prev.trim(), id: Date.now().toString() }]);
                }
                return '';
              });
            }

            if (message.serverContent?.turnComplete) {
              setCurrentAiText(prev => {
                if (prev.trim()) {
                  setTranscript(t => [...t, { role: 'ai', text: prev.trim(), id: Date.now().toString() }]);
                }
                return '';
              });
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              setIsAiSpeaking(false);
              setCurrentAiText(prev => {
                if (prev.trim()) {
                  setTranscript(t => [...t, { role: 'ai', text: prev.trim(), id: Date.now().toString() }]);
                }
                return '';
              });
            }
          },
          onclose: () => {
            disconnect();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error occurred.");
            disconnect();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error("Failed to connect:", err);
      setError(err.message || "Failed to access microphone or connect to AI.");
      setIsConnecting(false);
      disconnect();
    }
  }, [systemInstruction]);

  const playNextAudio = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) {
      if (audioQueueRef.current.length === 0) {
        setIsAiSpeaking(false);
      }
      return;
    }

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift()!;
    const audioCtx = audioContextRef.current;

    const buffer = audioCtx.createBuffer(1, audioData.length, 24000);
    buffer.copyToChannel(audioData, 0);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    const currentTime = audioCtx.currentTime;
    const startTime = Math.max(currentTime, nextPlayTimeRef.current);
    
    source.playbackRate.value = playbackRateRef.current;
    source.start(startTime);
    nextPlayTimeRef.current = startTime + (buffer.duration / playbackRateRef.current);

    source.onended = () => {
      isPlayingRef.current = false;
      playNextAudio();
    };
  }, []);

  const disconnect = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close()).catch(console.error);
      sessionRef.current = null;
    }
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
    
    setIsConnected(false);
    setIsConnecting(false);
    setIsAiSpeaking(false);
    setIsMuted(false);
    setCurrentAiText('');
    setCurrentUserText('');
  }, []);

  const toggleMute = useCallback(() => {
    if (mediaStreamRef.current) {
      const audioTracks = mediaStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const currentlyEnabled = audioTracks[0].enabled;
        audioTracks.forEach(track => {
          track.enabled = !currentlyEnabled;
        });
        setIsMuted(currentlyEnabled); // If it was enabled, it is now muted (true)
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isConnecting,
    error,
    transcript,
    currentAiText,
    currentUserText,
    isAiSpeaking,
    isMuted,
    connect,
    disconnect,
    toggleMute
  };
}
