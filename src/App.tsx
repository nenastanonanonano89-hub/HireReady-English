/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Settings, Play, Square, Loader2, User, MessageSquare, ThumbsUp, ThumbsDown, LogIn, LogOut, Check, Volume2, Star, Flame, Trophy, Award, BookOpen, Headphones, Briefcase, Lock, Brain, CheckCircle, RefreshCw, ArrowRight, MessageCircle, HelpCircle, Book, BarChart3 } from 'lucide-react';
import { useLiveAPI } from './hooks/useLiveAPI';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { auth, signInWithGoogle, logOut, db } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface Exercise {
  id: string;
  type: 'grammar' | 'vocabulary';
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  task: string;
  taskAr: string;
  correctAnswer: string;
  explanation: string;
  explanationAr: string;
}

interface SessionSummary {
  feedback: string;
  feedbackAr: string;
  strengths: string[];
  weaknesses: string[];
  exercises: Exercise[];
  score: number;
  difficultWords?: string[];
}

interface BadgeItem {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  icon: any;
  color: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [ratedMessages, setRatedMessages] = useState<Record<string, 'up' | 'down'>>({});
  const [mode, setMode] = useState<'landing' | 'selection' | 'setup' | 'interview' | 'summary' | 'lessons' | 'stats'>('landing');
  const [jobTitle, setJobTitle] = useState('Customer Service Representative');
  const [interviewType, setInterviewType] = useState('Call Center');
  const [englishLevel, setEnglishLevel] = useState('Beginner');
  const [interviewerTone, setInterviewerTone] = useState<'Friendly' | 'Formal' | 'Challenging'>('Friendly');
  const [scenario, setScenario] = useState('General Interview');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [pronunciationWord, setPronunciationWord] = useState('');
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(1);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [exerciseAnswers, setExerciseAnswers] = useState<Record<string, string>>({});
  const [exerciseResults, setExerciseResults] = useState<Record<string, boolean | null>>({});
  const [unlockedBadges, setUnlockedBadges] = useState<string[]>([]);
  const [newlyUnlockedBadges, setNewlyUnlockedBadges] = useState<string[]>([]);

  const BADGES: BadgeItem[] = [
    { id: 'first_interview', name: 'First Step', nameAr: 'الخطوة الأولى', description: 'Completed your first interview session.', descriptionAr: 'أكملت أول جلسة مقابلة لك.', icon: Star, color: 'text-yellow-500 bg-yellow-100' },
    { id: 'high_score', name: 'High Achiever', nameAr: 'متفوق', description: 'Scored 90% or higher in a session.', descriptionAr: 'حصلت على 90% أو أكثر في جلسة واحدة.', icon: Trophy, color: 'text-purple-500 bg-purple-100' },
    { id: 'call_center_pro', name: 'Call Center Pro', nameAr: 'محترف كول سنتر', description: 'Completed a Call Center interview.', descriptionAr: 'أكملت مقابلة كول سنتر.', icon: Headphones, color: 'text-blue-500 bg-blue-100' },
    { id: 'conversation_master', name: 'Conversation Master', nameAr: 'سيد المحادثة', description: 'Completed a Conversation session.', descriptionAr: 'أكملت جلسة محادثة.', icon: MessageSquare, color: 'text-green-500 bg-green-100' },
    { id: 'streak_starter', name: 'Streak Starter', nameAr: 'بداية الحماس', description: 'Maintained a 3-day streak.', descriptionAr: 'حافظت على سلسلة لمدة 3 أيام.', icon: Flame, color: 'text-orange-500 bg-orange-100' },
  ];

  const LEVELS = [
    { id: 1, name: 'Basic English', nameAr: 'إنجليزي أساسي', type: 'Conversation', color: 'bg-green-500', minXp: 0, maxXp: 100, icon: BookOpen, desc: 'Start from scratch with basic words.', descAr: 'ابدأ من الصفر بكلمات أساسية' },
    { id: 2, name: 'Conversations', nameAr: 'محادثات', type: 'Conversation', color: 'bg-blue-500', minXp: 100, maxXp: 300, icon: MessageSquare, desc: 'Practice daily English conversations.', descAr: 'تدرب على المحادثات اليومية' },
    { id: 3, name: 'Customer Service', nameAr: 'خدمة العملاء', type: 'Customer Service', color: 'bg-yellow-500', minXp: 300, maxXp: 600, icon: Headphones, desc: 'Train for support and call center roles.', descAr: 'تدرب على أدوار الدعم الفني والكول سنتر' },
    { id: 4, name: 'Interview', nameAr: 'مقابلة عمل', type: 'Interview', color: 'bg-red-500', minXp: 600, maxXp: 1000, icon: Briefcase, desc: 'Mock interviews for your target job.', descAr: 'مقابلات وهمية لوظيفتك المستهدفة' },
  ];

  const LESSONS = [
    { id: 1, title: 'Greetings & Introductions', titleAr: 'التحيات والتعريف بالنفس', level: 'Beginner', xp: 50, icon: MessageCircle, content: 'Learn how to say hello and introduce yourself in a professional way.' },
    { id: 2, title: 'Common Interview Questions', titleAr: 'أسئلة المقابلة الشائعة', level: 'Intermediate', xp: 100, icon: HelpCircle, content: 'Master the most frequent questions like "Tell me about yourself".' },
    { id: 3, title: 'Customer Service Phrases', titleAr: 'عبارات خدمة العملاء', level: 'Beginner', xp: 75, icon: Headphones, content: 'Essential phrases for handling customers politely and effectively.' },
    { id: 4, title: 'Grammar: Past Tense', titleAr: 'القواعد: الزمن الماضي', level: 'Beginner', xp: 60, icon: Book, content: 'How to talk about your past experience correctly.' },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const systemInstruction = `You are an expert, encouraging English coach and a professional job interviewer. 
Your brand personality is: Encouraging 💪, Simple 🧠, Practical 🎯, and Smart 🤖.

INTERVIEWER SETTINGS:
- Tone: ${interviewerTone}. (Friendly: warm and supportive; Formal: professional and direct; Challenging: asks tough follow-up questions and tests limits).
- Scenario: ${scenario}.
- Target Job: ${jobTitle}.
- English Level: ${englishLevel}.

CRITICAL INSTRUCTIONS FOR BEGINNERS:
1. TRANSLATION: The user is a beginner. You MUST provide an Arabic translation for ALL your English text. Whenever you ask a question or give feedback in English, immediately provide the Arabic translation next to it or on the next line. 
2. PRONUNCIATION: Provide detailed explanations of common errors for specific sounds (e.g., P vs B, TH vs S/Z for Arabic speakers). Provide a clear phonetic breakdown (e.g., 'fuh-NET-ik') and give 2-3 examples of correct pronunciation.

Your tone of voice is like a friendly coach, but adapted to the selected ${interviewerTone} tone. You MUST use these specific Arabic phrases to encourage the user:
- "حلو 👏 كده ممتاز" (When they do well)
- "خلينا نحسن الجملة دي" (When correcting a sentence)
- "أنت قربت تبقى جاهز للشغل 🔥" (To motivate them)

The user is preparing for a ${interviewType} session. Their English proficiency level is ${englishLevel}.

Follow this structured process for every turn:
1. Ask a relevant question suitable for their level and the ${scenario} scenario. (Provide Arabic translation).
2. Wait for the user to answer.
3. After they answer, provide specific, structured feedback:
   - Content: Evaluate their answer based on the ${jobTitle} role. (With Arabic translation).
   - Grammar: Point out mistakes and provide the correct version. Use "خلينا نحسن الجملة دي". (With Arabic translation).
   - Vocabulary & Pronunciation: Explain sound errors in detail, give phonetic breakdowns, and provide examples.
4. Praise them using "حلو 👏 كده ممتاز" or "أنت قربت تبقى جاهز للشغل 🔥".
5. Ask the next question, increasing complexity if they are doing well, or keeping it simple if they struggle. (With Arabic translation).

Speak clearly, slowly, and at a pace suitable for a ${englishLevel} English learner. Be extremely patient and encouraging.`;

  const { isConnected, isConnecting, error, transcript, currentAiText, currentUserText, isAiSpeaking, isMuted, connect, disconnect, toggleMute } = useLiveAPI(systemInstruction, playbackRate);

  useEffect(() => {
    // Simple gamification: +20 XP per AI response
    const aiResponses = transcript.filter(t => t.role === 'ai').length;
    const newXp = aiResponses * 20;
    setXp(newXp);
    
    let newLevel = 1;
    if (newXp >= 600) newLevel = 4;
    else if (newXp >= 300) newLevel = 3;
    else if (newXp >= 100) newLevel = 2;
    
    setCurrentLevel(newLevel);
  }, [transcript]);

  const handleRate = async (messageId: string, text: string, rating: 'up' | 'down') => {
    if (!user) {
      alert("Please sign in to rate feedback.");
      return;
    }
    
    setRatedMessages(prev => ({ ...prev, [messageId]: rating }));
    
    try {
      await addDoc(collection(db, 'feedback'), {
        userId: user.uid,
        aiResponse: text,
        rating,
        jobTitle,
        interviewType,
        englishLevel,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'feedback');
    }
  };

  const generateSessionSummary = async () => {
    setIsAnalyzing(true);
    setMode('summary');
    setExerciseAnswers({});
    setExerciseResults({});
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";
      
      const transcriptText = transcript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');
      
      const prompt = `Analyze the following English interview transcript for a ${englishLevel} level student applying for a ${jobTitle} role.
      Transcript:
      ${transcriptText}
      
      Provide a comprehensive session summary in JSON format.
      The summary should include:
      1. feedback: Overall feedback on their performance in English.
      2. feedbackAr: Arabic translation of the feedback.
      3. strengths: A list of 2-3 things they did well.
      4. weaknesses: A list of 2-3 things they need to improve (grammar, vocabulary, etc.).
      5. score: A score from 0 to 100 based on their performance.
      6. difficultWords: A list of 3-5 specific words or phrases from the transcript that the user likely struggled with or should practice pronouncing.
      7. exercises: A list of 3 targeted practice exercises based on their weaknesses.
         Each exercise should have:
         - id: unique string
         - type: 'grammar' or 'vocabulary'
         - title: short title
         - titleAr: Arabic title
         - description: clear instructions in English
         - descriptionAr: Arabic instructions
         - task: the actual question or sentence to complete (e.g., "I ___ to the store yesterday. (go)")
         - taskAr: Arabic translation of the task
         - correctAnswer: the correct word or phrase
         - explanation: why this is correct in English
         - explanationAr: Arabic explanation
      
      Ensure the output is valid JSON.`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              feedback: { type: Type.STRING },
              feedbackAr: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              score: { type: Type.NUMBER },
              difficultWords: { type: Type.ARRAY, items: { type: Type.STRING } },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    type: { type: Type.STRING },
                    title: { type: Type.STRING },
                    titleAr: { type: Type.STRING },
                    description: { type: Type.STRING },
                    descriptionAr: { type: Type.STRING },
                    task: { type: Type.STRING },
                    taskAr: { type: Type.STRING },
                    correctAnswer: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    explanationAr: { type: Type.STRING },
                  },
                  required: ["id", "type", "title", "titleAr", "description", "descriptionAr", "task", "taskAr", "correctAnswer", "explanation", "explanationAr"]
                }
              }
            },
            required: ["feedback", "feedbackAr", "strengths", "weaknesses", "score", "exercises"]
          }
        }
      });

      if (response.text) {
        const summary = JSON.parse(response.text);
        setSessionSummary(summary);
        
        // Update XP based on score
        const earnedXp = Math.floor(summary.score / 2);
        setXp(prev => prev + earnedXp);

        // Check for badges
        const newBadges: string[] = [];
        if (!unlockedBadges.includes('first_interview')) newBadges.push('first_interview');
        if (summary.score >= 90 && !unlockedBadges.includes('high_score')) newBadges.push('high_score');
        if (scenario === 'Customer Support' && !unlockedBadges.includes('call_center_pro')) newBadges.push('call_center_pro');
        if (scenario === 'General Interview' && !unlockedBadges.includes('conversation_master')) newBadges.push('conversation_master');
        if (streak >= 3 && !unlockedBadges.includes('streak_starter')) newBadges.push('streak_starter');

        if (newBadges.length > 0) {
          setUnlockedBadges(prev => [...prev, ...newBadges]);
          setNewlyUnlockedBadges(newBadges);
        } else {
          setNewlyUnlockedBadges([]);
        }
      }
      
    } catch (err) {
      console.error("Error generating summary:", err);
      // Don't set mode to selection here, let the UI handle the error state or empty summary
    } finally {
      setIsAnalyzing(false);
    }
  };

  const checkExercise = (id: string, answer: string, correctAnswer: string) => {
    const isCorrect = answer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
    setExerciseResults(prev => ({ ...prev, [id]: isCorrect }));
    if (isCorrect) {
      setXp(prev => prev + 10);
    }
  };

  const speakText = (text: string, rate: number = 1) => {
    if ('speechSynthesis' in window && text) {
      window.speechSynthesis.cancel();
      // Remove Arabic text for better TTS quality
      const englishOnly = text.replace(/[\u0600-\u06FF]/g, '').trim();
      const utterance = new SpeechSynthesisUtterance(englishOnly);
      utterance.lang = 'en-US';
      utterance.rate = rate;
      window.speechSynthesis.speak(utterance);
    }
  };

  const speakWord = (word: string) => {
    speakText(word, 0.7);
  };

  const handleStart = () => {
    setMode('interview');
    connect();
  };

  const handleStop = async () => {
    disconnect();
    if (transcript.length > 0) {
      await generateSessionSummary();
    } else {
      setMode('selection');
    }
  };

  const handleModeSelect = (selectedMode: string) => {
    setInterviewType(selectedMode);
    // Set default scenario based on mode
    if (selectedMode === 'Conversation') setScenario('General Interview');
    else if (selectedMode === 'Customer Service') setScenario('Customer Support');
    else if (selectedMode === 'Interview') setScenario('General Interview');
    
    setMode('setup');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-brand-green/30">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 bg-brand-blue rounded-xl shadow-sm">
            <MessageSquare className="w-6 h-6 text-white" />
            <div className="absolute -bottom-1 -right-1 bg-brand-green rounded-full p-0.5 border-2 border-white">
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            </div>
          </div>
          <h1 className="text-2xl font-heading font-bold tracking-tight text-brand-blue">HireReady English</h1>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden md:flex items-center gap-2 mr-4">
              <Button variant="ghost" size="sm" onClick={() => setMode('stats')} className="text-slate-600 hover:text-brand-blue">
                <BarChart3 className="w-4 h-4 mr-1" /> Stats
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode('lessons')} className="text-slate-600 hover:text-brand-green">
                <BookOpen className="w-4 h-4 mr-1" /> Lessons
              </Button>
            </div>
          )}
          {mode === 'interview' && (
            <Badge className="bg-brand-green hover:bg-brand-green/90 text-white animate-in fade-in">
              {isConnected ? 'Live' : 'Connecting...'}
            </Badge>
          )}
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 hidden sm:inline-block">{user.email}</span>
              <Button variant="ghost" size="sm" onClick={logOut}><LogOut className="w-4 h-4 mr-2"/> Sign Out</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={signInWithGoogle}><LogIn className="w-4 h-4 mr-2"/> Sign In</Button>
          )}
        </div>
      </header>

      <main className={mode === 'landing' ? "w-full" : "max-w-4xl mx-auto p-6 pt-12"}>
        <AnimatePresence mode="wait">
          {mode === 'landing' ? (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center"
            >
              {/* Hero Section */}
              <section className="w-full bg-brand-blue text-white py-20 px-6 relative overflow-hidden">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,_#00C897_0%,_transparent_70%)]"></div>
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12 relative z-10">
                  <div className="flex-1 text-center md:text-left">
                    <motion.h2 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="text-5xl md:text-7xl font-heading font-extrabold tracking-tight mb-6 leading-tight"
                    >
                      Master English.<br/>
                      <span className="text-brand-green">Get Hired.</span>
                    </motion.h2>
                    <motion.p 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="text-xl text-slate-300 mb-8 max-w-xl"
                    >
                      The AI-powered interview coach designed for non-native speakers. Practice real-world scenarios and get instant feedback.
                    </motion.p>
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start"
                    >
                      <Button 
                        size="lg" 
                        onClick={() => setMode('selection')}
                        className="bg-brand-green hover:bg-brand-green/90 text-white text-lg px-8 py-6 rounded-2xl font-bold shadow-lg shadow-brand-green/20"
                      >
                        Start Challenge (ابدأ التحدي)
                      </Button>
                      <Button 
                        size="lg" 
                        variant="outline" 
                        className="border-white/20 text-white hover:bg-white/10 text-lg px-8 py-6 rounded-2xl font-bold"
                      >
                        Learn More (اعرف المزيد)
                      </Button>
                    </motion.div>
                  </div>
                  <div className="flex-1 relative">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={{ delay: 0.5, type: 'spring' }}
                      className="bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/10 shadow-2xl relative"
                    >
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-full bg-brand-green flex items-center justify-center">
                          <User className="text-white w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-bold text-white">AI Interviewer</p>
                          <p className="text-xs text-slate-400">Online & Ready</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                          <p className="text-sm text-slate-300">"Tell me about a time you handled a difficult customer..."</p>
                        </div>
                        <div className="bg-brand-green/20 p-4 rounded-2xl border border-brand-green/20 ml-8">
                          <p className="text-sm text-white">"I once had a customer who was very frustrated with..."</p>
                        </div>
                      </div>
                      <div className="mt-8 flex justify-center">
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="w-1 h-8 bg-brand-green rounded-full animate-pulse" style={{ animationDelay: `${i * 0.1}s` }}></div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </section>

              {/* Features Section */}
              <section className="py-24 px-6 max-w-6xl mx-auto w-full">
                <div className="text-center mb-16">
                  <h3 className="text-3xl md:text-4xl font-heading font-bold text-brand-blue mb-4">Why HireReady?</h3>
                  <p className="text-slate-500 max-w-2xl mx-auto">Everything you need to go from zero to job-ready in weeks, not years.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {[
                    { icon: Headphones, title: 'Real Scenarios', desc: 'Practice for Call Centers, Customer Support, and more.', color: 'text-blue-500 bg-blue-50' },
                    { icon: Brain, title: 'AI Feedback', desc: 'Get instant grammar, vocabulary, and pronunciation tips.', color: 'text-green-500 bg-green-50' },
                    { icon: Trophy, title: 'Gamified Growth', desc: 'Earn XP, unlock badges, and track your daily streak.', color: 'text-yellow-500 bg-yellow-50' },
                  ].map((feature, i) => (
                    <motion.div 
                      key={i}
                      whileHover={{ y: -10 }}
                      className="p-8 rounded-3xl bg-white border border-slate-100 shadow-sm hover:shadow-xl transition-all"
                    >
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${feature.color}`}>
                        <feature.icon className="w-7 h-7" />
                      </div>
                      <h4 className="text-xl font-bold text-brand-blue mb-3">{feature.title}</h4>
                      <p className="text-slate-500 leading-relaxed">{feature.desc}</p>
                    </motion.div>
                  ))}
                </div>
              </section>

              {/* CTA Section */}
              <section className="w-full bg-slate-50 py-20 px-6">
                <div className="max-w-4xl mx-auto text-center bg-white p-12 rounded-[3rem] border border-slate-200 shadow-xl">
                  <h3 className="text-3xl md:text-4xl font-heading font-bold text-brand-blue mb-6" dir="rtl">جاهز تبدأ رحلتك؟</h3>
                  <p className="text-lg text-slate-500 mb-10 max-w-xl mx-auto">Join thousands of students who are already mastering English and landing their dream jobs.</p>
                  <Button 
                    size="lg" 
                    onClick={() => setMode('selection')}
                    className="bg-brand-blue hover:bg-brand-blue/90 text-white text-xl px-12 py-8 rounded-2xl font-bold shadow-xl shadow-brand-blue/20"
                  >
                    Get Started Now
                  </Button>
                </div>
              </section>

              {/* Footer */}
              <footer className="py-12 text-center text-slate-400 text-sm">
                <p>© 2026 HireReady English. All rights reserved.</p>
              </footer>
            </motion.div>
          ) : mode === 'lessons' ? (
            <motion.div
              key="lessons"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-heading font-bold text-brand-blue mb-2">Interactive Lessons (دروس تفاعلية)</h2>
                  <p className="text-slate-500">Master English skills step-by-step. (تعلم مهارات الإنجليزية خطوة بخطوة)</p>
                </div>
                <Button variant="outline" onClick={() => setMode('selection')}>Back to Dashboard</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {LESSONS.map((lesson) => {
                  const Icon = lesson.icon;
                  return (
                    <Card key={lesson.id} className="hover:shadow-md transition-all border-slate-200">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <div className="w-12 h-12 rounded-xl bg-brand-green/10 flex items-center justify-center text-brand-green">
                            <Icon className="w-6 h-6" />
                          </div>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none">{lesson.level}</Badge>
                        </div>
                        <CardTitle className="text-xl font-bold text-brand-blue mt-4">
                          {lesson.title}<br/>
                          <span className="text-sm font-normal opacity-70" dir="rtl">{lesson.titleAr}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-slate-600 mb-6">{lesson.content}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-yellow-500 font-bold">
                            <Star className="w-4 h-4 fill-current" />
                            <span>+{lesson.xp} XP</span>
                          </div>
                          <Button className="bg-brand-blue hover:bg-brand-blue/90 text-white">Start Lesson</Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </motion.div>
          ) : mode === 'stats' ? (
            <motion.div
              key="stats"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-heading font-bold text-brand-blue mb-2">Your Progress (إحصائياتك)</h2>
                  <p className="text-slate-500">Track your English journey. (تتبع رحلتك التعليمية)</p>
                </div>
                <Button variant="outline" onClick={() => setMode('selection')}>Back to Dashboard</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
                {[
                  { label: 'Total XP', value: xp, icon: Star, color: 'text-yellow-500' },
                  { label: 'Day Streak', value: streak, icon: Flame, color: 'text-orange-500' },
                  { label: 'Sessions', value: '12', icon: MessageSquare, color: 'text-blue-500' },
                  { label: 'Badges', value: unlockedBadges.length, icon: Trophy, color: 'text-purple-500' },
                ].map((stat, i) => (
                  <Card key={i} className="border-slate-200">
                    <CardContent className="p-6 flex flex-col items-center text-center">
                      <stat.icon className={`w-8 h-8 ${stat.color} mb-2`} />
                      <p className="text-3xl font-bold text-brand-blue">{stat.value}</p>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border-slate-200 mb-10">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-brand-blue">Weekly Activity</CardTitle>
                </CardHeader>
                <CardContent className="h-64 flex items-end justify-between gap-2 pt-10">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                    const height = [20, 45, 30, 80, 50, 20, 10][i];
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center gap-2">
                        <div 
                          className={`w-full rounded-t-lg transition-all duration-1000 ${i === 3 ? 'bg-brand-green' : 'bg-slate-200'}`}
                          style={{ height: `${height}%` }}
                        ></div>
                        <span className="text-xs font-bold text-slate-400">{day}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-brand-blue">Skill Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {[
                      { skill: 'Pronunciation', level: 75 },
                      { skill: 'Grammar', level: 60 },
                      { skill: 'Vocabulary', level: 85 },
                      { skill: 'Fluency', level: 40 },
                    ].map((skill) => (
                      <div key={skill.skill} className="space-y-2">
                        <div className="flex justify-between text-sm font-bold">
                          <span>{skill.skill}</span>
                          <span>{skill.level}%</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-brand-blue rounded-full" 
                            style={{ width: `${skill.level}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-brand-blue">Recent Achievements</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {unlockedBadges.slice(0, 3).map(badgeId => {
                      const badge = BADGES.find(b => b.id === badgeId);
                      if (!badge) return null;
                      return (
                        <div key={badgeId} className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${badge.color}`}>
                            <badge.icon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-sm text-brand-blue">{badge.name}</p>
                            <p className="text-xs text-slate-500">{badge.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          ) : mode === 'selection' ? (
            <motion.div
              key="selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              <div className="mb-10">
                <h2 className="text-4xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-brand-blue">
                  HireReady Challenge 🎮<br/>
                  <span className="text-3xl md:text-4xl text-brand-green mt-3 block" dir="rtl">اتكلم إنجليزي… واشتغل فورًا</span>
                </h2>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto font-medium" dir="rtl">
                  تمكين أي شخص من إنه يشتغل باستخدام اللغة الإنجليزية حتى لو مستواه صفر
                </p>
                <p className="text-md text-slate-500 max-w-2xl mx-auto mt-2" dir="rtl">
                  رسالتنا: تقديم تجربة تعليمية تفاعلية بالذكاء الاصطناعي تحاكي سوق العمل الحقيقي وتجهزك للوظيفة
                </p>
              </div>

              {/* Gamification Dashboard */}
              <div className="max-w-3xl mx-auto mb-10">
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <Card className="bg-white border-slate-200 shadow-sm">
                    <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                      <Star className="w-8 h-8 text-yellow-400 mb-2" />
                      <p className="text-2xl font-bold text-brand-blue">{xp}</p>
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">XP Points (نقاط)</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-white border-slate-200 shadow-sm">
                    <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                      <Flame className="w-8 h-8 text-orange-500 mb-2" />
                      <p className="text-2xl font-bold text-brand-blue">{streak}</p>
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Day Streak (أيام متتالية)</p>
                    </CardContent>
                  </Card>
                  <Card className={`border-slate-200 shadow-sm ${currentLevel === 4 ? 'bg-brand-green/10 border-brand-green/30' : 'bg-white'}`}>
                    <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                      {currentLevel === 4 ? <Award className="w-8 h-8 text-brand-green mb-2" /> : <Trophy className="w-8 h-8 text-slate-300 mb-2" />}
                      <p className="text-xl font-bold text-brand-blue leading-tight">Lvl {currentLevel}</p>
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{LEVELS[currentLevel-1].name}</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex justify-between text-sm mb-2 font-semibold text-slate-600">
                    <span className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${LEVELS[currentLevel-1].color}`}></div>
                      Level {currentLevel}: {LEVELS[currentLevel-1].name} ({LEVELS[currentLevel-1].nameAr})
                    </span>
                    <span>{xp} / {LEVELS[currentLevel-1].maxXp} XP</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${LEVELS[currentLevel-1].color} transition-all duration-1000 ease-out`} 
                      style={{ width: `${Math.min(100, Math.max(0, ((xp - LEVELS[currentLevel-1].minXp) / (LEVELS[currentLevel-1].maxXp - LEVELS[currentLevel-1].minXp)) * 100))}%` }}
                    ></div>
                  </div>
                </div>

                {currentLevel === 4 && (
                  <div className="mt-4 flex items-center justify-center gap-2 bg-brand-green/10 text-brand-green p-3 rounded-lg font-bold border border-brand-green/20 animate-in zoom-in">
                    <Award className="w-6 h-6" />
                    Job Ready Badge Unlocked! 🏆 (تم فتح شارة الجاهزية للعمل!)
                  </div>
                )}
              </div>

              {/* Badges Section */}
              <div className="max-w-3xl mx-auto mb-10">
                <h3 className="text-xl font-bold text-brand-blue mb-4 flex items-center justify-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  Your Badges (شاراتك)
                </h3>
                <div className="flex flex-wrap justify-center gap-4">
                  {BADGES.map((badge) => {
                    const isUnlocked = unlockedBadges.includes(badge.id);
                    const Icon = badge.icon;
                    return (
                      <div 
                        key={badge.id} 
                        className={`flex flex-col items-center p-3 rounded-xl border transition-all w-28 ${isUnlocked ? 'bg-white border-slate-200 shadow-sm opacity-100 scale-100' : 'bg-slate-50 border-slate-100 opacity-40 grayscale scale-95'}`}
                        title={isUnlocked ? badge.description : 'Locked'}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 ${isUnlocked ? badge.color : 'bg-slate-200 text-slate-400'}`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <p className={`text-[10px] font-bold text-center leading-tight ${isUnlocked ? 'text-brand-blue' : 'text-slate-400'}`}>
                          {badge.name}<br/>
                          <span className="text-[8px] font-normal opacity-70" dir="rtl">{badge.nameAr}</span>
                        </p>
                        {!isUnlocked && <Lock className="w-3 h-3 text-slate-300 mt-1" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-2xl font-bold text-brand-blue">Select Your Level (اختر مستواك)</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-10">
                {LEVELS.map((level) => {
                  const isUnlocked = true; // All levels unlocked for testing
                  const Icon = level.icon;
                  return (
                    <Card 
                      key={level.id}
                      className={`transition-all border-2 ${isUnlocked ? 'cursor-pointer hover:border-brand-green hover:shadow-md border-transparent' : 'opacity-70 border-slate-200 bg-slate-50'}`}
                      onClick={() => {
                        if (isUnlocked) {
                          handleModeSelect(level.type);
                        }
                      }}
                    >
                      <CardContent className="p-6 flex flex-col items-center justify-center text-center h-full relative">
                        {!isUnlocked && (
                          <div className="absolute top-4 right-4 text-slate-400">
                            <Lock className="w-5 h-5" />
                          </div>
                        )}
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isUnlocked ? level.color.replace('bg-', 'bg-').replace('500', '100') : 'bg-slate-200'}`}>
                          <Icon className={`w-8 h-8 ${isUnlocked ? level.color.replace('bg-', 'text-') : 'text-slate-400'}`} />
                        </div>
                        <h3 className={`text-xl font-bold mb-2 ${isUnlocked ? 'text-brand-blue' : 'text-slate-500'}`}>
                          Level {level.id}: {level.name} <span className="text-lg font-normal opacity-70" dir="rtl">({level.nameAr})</span>
                        </h3>
                        <p className="text-sm text-slate-500">{level.desc}</p>
                        <p className="text-xs text-slate-400 italic mt-1" dir="rtl">({level.descAr})</p>
                        {!isUnlocked && (
                          <p className="text-xs font-semibold text-slate-400 mt-4">
                            Unlocks at {level.minXp} XP (يفتح عند {level.minXp} نقطة)
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </motion.div>
          ) : mode === 'setup' ? (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-6">
                <Button variant="ghost" onClick={() => setMode('selection')} className="text-slate-500 hover:text-slate-800">
                  ← Back to Levels (العودة للمستويات)
                </Button>
              </div>

              <Card className="max-w-xl mx-auto shadow-lg border-slate-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-2xl font-heading text-brand-blue">
                    <Settings className="w-6 h-6 text-brand-green" />
                    {interviewType} Setup (إعداد الجلسة)
                  </CardTitle>
                  <CardDescription>Configure your session. (قم بإعداد جلستك)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="jobTitle" className="text-sm font-semibold">Target Job Title (المسمى الوظيفي)</Label>
                    <Input 
                      id="jobTitle" 
                      value={jobTitle} 
                      onChange={(e) => setJobTitle(e.target.value)} 
                      placeholder="e.g. Customer Service, Sales (مثال: خدمة عملاء، مبيعات)"
                      className="bg-slate-50"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="interviewType" className="text-sm font-semibold">Industry/Scenario (المجال/السيناريو)</Label>
                      <Select value={scenario} onValueChange={setScenario}>
                        <SelectTrigger id="scenario" className="bg-slate-50">
                          <SelectValue placeholder="Select scenario (اختر السيناريو)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="General Interview">General Interview (مقابلة عامة)</SelectItem>
                          <SelectItem value="Customer Support">Customer Support (دعم العملاء)</SelectItem>
                          <SelectItem value="Sales & Pitching">Sales & Pitching (المبيعات)</SelectItem>
                          <SelectItem value="Technical Troubleshooting">Technical Troubleshooting (حل المشاكل التقنية)</SelectItem>
                          <SelectItem value="Retail & Hospitality">Retail & Hospitality (التجزئة والضيافة)</SelectItem>
                          <SelectItem value="Office Administration">Office Administration (إدارة المكاتب)</SelectItem>
                          <SelectItem value="Healthcare Support">Healthcare Support (دعم الرعاية الصحية)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="englishLevel" className="text-sm font-semibold">English Level (مستوى الإنجليزي)</Label>
                      <Select value={englishLevel} onValueChange={setEnglishLevel}>
                        <SelectTrigger id="englishLevel" className="bg-slate-50">
                          <SelectValue placeholder="Select level (اختر المستوى)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Beginner">Beginner - مبتدئ (A1-A2)</SelectItem>
                          <SelectItem value="Intermediate">Intermediate - متوسط (B1-B2)</SelectItem>
                          <SelectItem value="Advanced">Advanced - متقدم (C1-C2)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="interviewerTone" className="text-sm font-semibold">Interviewer Tone (نبرة المحاور)</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['Friendly', 'Formal', 'Challenging'] as const).map((tone) => (
                        <Button
                          key={tone}
                          variant={interviewerTone === tone ? 'default' : 'outline'}
                          className={`h-10 text-xs ${interviewerTone === tone ? 'bg-brand-blue' : 'bg-slate-50'}`}
                          onClick={() => setInterviewerTone(tone)}
                        >
                          {tone === 'Friendly' && 'Friendly (ودود)'}
                          {tone === 'Formal' && 'Formal (رسمي)'}
                          {tone === 'Challenging' && 'Challenging (تحدي)'}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-slate-50 border-t border-slate-100 rounded-b-xl p-6">
                  <Button 
                    onClick={handleStart} 
                    className="w-full text-lg h-12 bg-brand-green hover:bg-[#00b386] text-white shadow-md transition-all font-heading font-semibold"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Start Training (ابدأ التدريب)
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="interview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
              className="max-w-2xl mx-auto"
            >
              <Card className="shadow-xl border-slate-200 overflow-hidden">
                <div className="bg-brand-blue p-8 text-center relative overflow-hidden">
                  {/* Atmospheric background for the interview room */}
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_50%_50%,_#00C897_0%,_transparent_60%)]"></div>
                  
                  <div className="relative z-10 flex flex-col items-center justify-center min-h-[200px]">
                    {isConnecting ? (
                      <div className="flex flex-col items-center text-white">
                        <Loader2 className="w-12 h-12 animate-spin text-brand-green mb-4" />
                        <p className="text-lg font-medium font-heading">Connecting to Interviewer... (جاري الاتصال...)</p>
                      </div>
                    ) : error ? (
                      <div className="text-red-400">
                        <p className="text-lg font-medium mb-2 font-heading">Connection Error (خطأ في الاتصال)</p>
                        <p className="text-sm opacity-80">{error}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <div className="relative mb-6">
                          <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isAiSpeaking ? 'bg-brand-green/20 shadow-[0_0_30px_rgba(0,200,151,0.5)] scale-110' : 'bg-white/10'}`}>
                            <User className={`w-12 h-12 ${isAiSpeaking ? 'text-brand-green' : 'text-slate-300'}`} />
                          </div>
                          {isMuted && (
                            <div className="absolute -bottom-2 -right-2 bg-red-500 p-2 rounded-full border-4 border-brand-blue shadow-lg animate-in zoom-in">
                              <MicOff className="w-5 h-5 text-white" />
                            </div>
                          )}
                        </div>
                        <h3 className="text-2xl font-bold font-heading text-white mb-2">
                          {isAiSpeaking ? 'Interviewer is speaking... (يتحدث الآن...)' : isMuted ? 'Microphone Muted (الميكروفون مغلق)' : 'Listening... (يستمع...)'}
                        </h3>
                        <p className="text-slate-300">
                          {isAiSpeaking ? 'Listen carefully to the question and feedback. (استمع جيداً)' : isMuted ? 'Unmute your microphone to speak. (افتح الميكروفون للتحدث)' : 'Speak your answer clearly. (تحدث بوضوح)'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                
                <CardContent className="p-6 bg-white">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                      <div className="w-2 h-2 rounded-full bg-brand-green"></div>
                      {jobTitle} • {interviewType}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={playbackRate.toString()} onValueChange={(v) => setPlaybackRate(parseFloat(v))}>
                        <SelectTrigger className="h-8 text-xs w-[110px] bg-slate-50 border-slate-200">
                          <SelectValue placeholder="Speed" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.75">0.75x Speed</SelectItem>
                          <SelectItem value="1">1x Speed</SelectItem>
                          <SelectItem value="1.25">1.25x Speed</SelectItem>
                          <SelectItem value="1.5">1.5x Speed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge variant="outline" className="text-slate-500 border-slate-200">
                        {englishLevel} English
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex justify-center gap-4">
                    <Button
                      variant={isMuted ? "outline" : "secondary"}
                      size="lg"
                      onClick={toggleMute}
                      className={`w-full max-w-[140px] shadow-sm ${isMuted ? 'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700' : ''}`}
                    >
                      {isMuted ? (
                        <><MicOff className="w-4 h-4 mr-2" /> Unmute (افتح الصوت)</>
                      ) : (
                        <><Mic className="w-4 h-4 mr-2" /> Mute (كتم الصوت)</>
                      )}
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="lg" 
                      onClick={handleStop}
                      className="w-full max-w-[140px] shadow-sm"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      End (إنهاء)
                    </Button>
                  </div>

                  {/* Display User Transcript */}
                  {(transcript.filter(t => t.role === 'user').length > 0 || currentUserText) && (
                    <div className="mt-6 border-t border-slate-100 pt-6">
                      <h4 className="text-sm font-semibold text-slate-900 mb-4">Your Response</h4>
                      <div className="bg-brand-green/10 rounded-lg p-4 text-sm text-slate-800 border border-brand-green/20">
                        {transcript.filter(t => t.role === 'user').slice(-1).map(msg => (
                          <p key={msg.id} className="mb-2 whitespace-pre-wrap">
                            {msg.text.split(' ').map((word, i) => (
                              <span 
                                key={i} 
                                className="hover:bg-brand-green/20 cursor-pointer rounded px-0.5 transition-colors"
                                onClick={() => speakWord(word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,""))}
                              >
                                {word}{' '}
                              </span>
                            ))}
                          </p>
                        ))}
                        {currentUserText && (
                          <p className="whitespace-pre-wrap text-brand-green italic">{currentUserText}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {transcript.filter(t => t.role === 'ai').length > 0 && (
                    <div className="mt-6 border-t border-slate-100 pt-6">
                      <h4 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        Latest Feedback
                        <span className="text-[10px] font-normal text-slate-400">(Click any word to hear it / اضغط على أي كلمة لسماعها)</span>
                      </h4>
                      {transcript.filter(t => t.role === 'ai').slice(-1).map(msg => (
                        <div key={msg.id} className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 border border-slate-100">
                          <div className="mb-4 whitespace-pre-wrap">
                            {msg.text.split(' ').map((word, i) => (
                              <span 
                                key={i} 
                                className="hover:bg-slate-200 cursor-pointer rounded px-0.5 transition-colors"
                                onClick={() => speakWord(word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,""))}
                              >
                                {word}{' '}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 mr-2">Rate this response:</span>
                              <Button 
                                variant={ratedMessages[msg.id] === 'up' ? 'default' : 'outline'} 
                                size="sm" 
                                className="h-8 px-3"
                                onClick={() => handleRate(msg.id, msg.text, 'up')}
                              >
                                <ThumbsUp className="w-3 h-3 mr-1" /> Helpful
                              </Button>
                              <Button 
                                variant={ratedMessages[msg.id] === 'down' ? 'destructive' : 'outline'} 
                                size="sm" 
                                className="h-8 px-3"
                                onClick={() => handleRate(msg.id, msg.text, 'down')}
                              >
                                <ThumbsDown className="w-3 h-3 mr-1" /> Not Helpful
                              </Button>
                            </div>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 text-xs border-brand-blue/20 text-brand-blue hover:bg-brand-blue/5"
                              onClick={() => speakText(msg.text)}
                            >
                              <Volume2 className="w-3 h-3 mr-1" /> Listen (استمع)
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              
              <div className="mt-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Speak naturally. The AI will wait for you to finish before responding. (تحدث بشكل طبيعي. سينتظر الذكاء الاصطناعي حتى تنتهي قبل الرد.)
              </div>

              {/* Pronunciation Practice Tool */}
              <Card className="shadow-md border-slate-200 mt-6 max-w-2xl mx-auto">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-heading text-brand-blue flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-brand-green" />
                    Pronunciation Practice (تدريب النطق)
                  </CardTitle>
                  <CardDescription>Type any difficult word or phrase to hear how it's pronounced. (اكتب أي كلمة صعبة لتسمع نطقها)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3">
                    <Input 
                      placeholder="e.g. specifically, enthusiastic... (مثال: specifically)" 
                      value={pronunciationWord}
                      onChange={(e) => setPronunciationWord(e.target.value)}
                      className="bg-slate-50 flex-1"
                    />
                    <Button 
                      onClick={() => {
                        if ('speechSynthesis' in window && pronunciationWord) {
                          const utterance = new SpeechSynthesisUtterance(pronunciationWord);
                          utterance.lang = 'en-US';
                          utterance.rate = 0.8;
                          window.speechSynthesis.speak(utterance);
                        }
                      }}
                      className="bg-brand-blue hover:bg-brand-blue/90 text-white font-heading"
                    >
                      <Volume2 className="w-4 h-4 mr-2" />
                      Listen (استمع)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {mode === 'summary' && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              {isAnalyzing ? (
                <Card className="shadow-xl border-slate-200 overflow-hidden">
                  <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-16 h-16 animate-spin text-brand-green mb-6" />
                    <h2 className="text-2xl font-heading font-bold text-brand-blue mb-2">Analyzing Your Performance...</h2>
                    <p className="text-slate-500">Identifying your strengths and creating targeted exercises for you.</p>
                  </CardContent>
                </Card>
              ) : sessionSummary ? (
                <div className="space-y-8">
                  <Card className="shadow-xl border-slate-200 overflow-hidden">
                    <div className="bg-brand-blue p-8 text-white text-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-green/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                      <Trophy className="w-16 h-16 mx-auto mb-4 text-yellow-400" />
                      <h2 className="text-3xl font-heading font-bold mb-2">Session Complete!</h2>
                      <div className="flex items-center justify-center gap-4 mt-6">
                        <div className="bg-white/10 px-6 py-3 rounded-2xl backdrop-blur-sm border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-70 mb-1">Performance Score</p>
                          <p className="text-4xl font-bold">{sessionSummary.score}%</p>
                        </div>
                        <div className="bg-white/10 px-6 py-3 rounded-2xl backdrop-blur-sm border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-70 mb-1">XP Earned</p>
                          <p className="text-4xl font-bold">+{Math.floor(sessionSummary.score / 2)}</p>
                        </div>
                      </div>

                      {newlyUnlockedBadges.length > 0 && (
                        <div className="mt-8 flex flex-wrap justify-center gap-4 animate-in slide-in-from-bottom-4">
                          {newlyUnlockedBadges.map(badgeId => {
                            const badge = BADGES.find(b => b.id === badgeId);
                            if (!badge) return null;
                            const Icon = badge.icon;
                            return (
                              <div key={badgeId} className="flex items-center gap-3 bg-white/20 p-2 pr-4 rounded-xl backdrop-blur-md border border-white/20 shadow-lg">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-white text-brand-blue`}>
                                  <Icon className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-300">New Badge!</p>
                                  <p className="text-xs font-bold text-white">{badge.name}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <CardContent className="p-8 bg-white">
                      <div className="grid md:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-lg font-bold text-brand-blue mb-4 flex items-center gap-2">
                            <Brain className="w-5 h-5 text-brand-green" />
                            Feedback (التعليقات)
                          </h3>
                          <p className="text-slate-700 mb-2">{sessionSummary.feedback}</p>
                          <p className="text-slate-500 italic text-sm" dir="rtl">{sessionSummary.feedbackAr}</p>
                          
                          {sessionSummary.difficultWords && sessionSummary.difficultWords.length > 0 && (
                            <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                              <h4 className="text-xs font-bold text-brand-blue uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Volume2 className="w-3 h-3" />
                                Pronunciation Coach (مدرب النطق)
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {sessionSummary.difficultWords.map((word, i) => (
                                  <Button 
                                    key={i} 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 bg-white hover:bg-brand-green/10 hover:text-brand-green border-slate-200"
                                    onClick={() => speakWord(word)}
                                  >
                                    <Volume2 className="w-3 h-3 mr-1" />
                                    {word}
                                  </Button>
                                ))}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-2 italic">Click to hear the correct pronunciation. (اضغط لسماع النطق الصحيح)</p>
                            </div>
                          )}
                        </div>
                        <div className="space-y-6">
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-green-500" />
                              Strengths
                            </h4>
                            <ul className="space-y-2">
                              {sessionSummary.strengths.map((s, i) => (
                                <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5"></div>
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <RefreshCw className="w-4 h-4 text-orange-500" />
                              Areas to Improve
                            </h4>
                            <ul className="space-y-2">
                              {sessionSummary.weaknesses.map((w, i) => (
                                <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5"></div>
                                  {w}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <h3 className="text-2xl font-heading font-bold text-brand-blue flex items-center gap-3">
                      <Award className="w-7 h-7 text-brand-green" />
                      Targeted Practice (تدريب مخصص)
                    </h3>
                    <div className="grid gap-6">
                      {sessionSummary.exercises.map((ex) => (
                        <Card key={ex.id} className={`border-slate-200 shadow-md transition-all ${exerciseResults[ex.id] === true ? 'border-green-200 bg-green-50/30' : exerciseResults[ex.id] === false ? 'border-red-200 bg-red-50/30' : ''}`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <Badge className={ex.type === 'grammar' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}>
                                {ex.type.toUpperCase()}
                              </Badge>
                              {exerciseResults[ex.id] === true && <Badge className="bg-green-500 text-white">Correct! +10 XP</Badge>}
                              {exerciseResults[ex.id] === false && <Badge variant="destructive">Try Again</Badge>}
                            </div>
                            <CardTitle className="text-xl mt-2">{ex.title} <span className="text-slate-400 font-normal text-sm ml-2">({ex.titleAr})</span></CardTitle>
                            <CardDescription>{ex.description} <span className="block italic text-xs mt-1">({ex.descriptionAr})</span></CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 mb-4">
                              <p className="text-lg font-medium text-slate-800 mb-2">{ex.task}</p>
                              <p className="text-sm text-slate-500 italic mb-4" dir="rtl">{ex.taskAr}</p>
                              <div className="flex gap-3">
                                <Input 
                                  placeholder="Type your answer..." 
                                  value={exerciseAnswers[ex.id] || ''}
                                  onChange={(e) => setExerciseAnswers(prev => ({ ...prev, [ex.id]: e.target.value }))}
                                  className="bg-white"
                                  disabled={exerciseResults[ex.id] === true}
                                />
                                <Button 
                                  onClick={() => checkExercise(ex.id, exerciseAnswers[ex.id] || '', ex.correctAnswer)}
                                  disabled={!exerciseAnswers[ex.id] || exerciseResults[ex.id] === true}
                                  className="bg-brand-blue hover:bg-slate-800"
                                >
                                  Check
                                </Button>
                              </div>
                            </div>
                            {exerciseResults[ex.id] !== undefined && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className={`p-4 rounded-lg text-sm ${exerciseResults[ex.id] ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                              >
                                <p className="font-bold mb-1">{exerciseResults[ex.id] ? 'Correct!' : 'Not quite right.'}</p>
                                <p className="mb-1">{ex.explanation}</p>
                                <p className="italic opacity-80" dir="rtl">{ex.explanationAr}</p>
                              </motion.div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-center pt-6 pb-12">
                    <Button 
                      size="lg" 
                      onClick={() => setMode('selection')}
                      className="bg-brand-blue hover:bg-slate-800 px-12"
                    >
                      Back to Dashboard (العودة للرئيسية)
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Card className="shadow-xl border-slate-200">
                  <CardContent className="p-12 text-center">
                    <p className="text-slate-500 mb-6">Something went wrong while analyzing your session.</p>
                    <Button onClick={() => setMode('selection')}>Back to Dashboard</Button>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
