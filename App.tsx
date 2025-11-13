

import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { Message, Author } from './types';
import { supabase } from './supabaseClient';

// A simple component for the blinking cursor effect.
const BlinkingCursor: React.FC = () => (
  <div className="w-2 h-5 bg-green-400 animate-pulse ml-1" />
);

// The main application component.
const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [copyText, setCopyText] = useState<string>('Invite');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- Notification and Realtime Logic ---

  // Draws a custom favicon, with an optional notification dot.
  const drawFavicon = (withNotification: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Base icon style
    ctx.fillStyle = '#1f2937'; // bg-gray-800
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#4ade80'; // text-green-400
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText('>', 4, 23);
    ctx.fillText('_', 14, 23);

    // Notification dot
    if (withNotification) {
      ctx.beginPath();
      ctx.arc(24, 8, 7, 0, 2 * Math.PI, false);
      ctx.fillStyle = '#ef4444'; // red-500
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff'; // white
      ctx.stroke();
    }

    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (link) {
      link.href = canvas.toDataURL('image/png');
    }
  };

  // Plays a simple "bleep" sound for notifications.
  const playNotificationSound = () => {
    if (!audioContextRef.current) return;
    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start(audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);
    oscillator.stop(audioContext.currentTime + 0.5);
  };
  
  // Effect to draw the initial favicon.
  useEffect(() => {
    drawFavicon(false);
  }, []);

  // Effect to handle browser tab visibility changes (to reset favicon).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        drawFavicon(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // --- Core Application Logic ---

  // On initial load, check URL for a room ID.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('room');
    if (id) {
      setRoomId(id);
    }
  }, []);

  // Load a room from Supabase, initialize chat, and subscribe to realtime updates.
  useEffect(() => {
    const loadRoomAndInitializeChat = async () => {
      if (!roomId) return;

      setIsLoading(true);
      try {
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        if (messageError) throw new Error(messageError.message);
        
        if (messageData.length === 0) {
            const { error: roomError } = await supabase.from('rooms').select('id').eq('id', roomId).single();
            if (roomError) throw new Error(`Chat room not found or invalid.`);
        }

        const storedMessages: Message[] = messageData.map(msg => ({ id: msg.id, author: msg.author as Author, text: msg.text }));
        setMessages(storedMessages);

        if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chatSession = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: {
            systemInstruction: `
Você é um assistente de inteligência artificial especialista em Linux, Shell Script, servidores, segurança e redes, integrado ao chat retrô "Chat Like Look Solutions".
Fale sempre em português. Seja direto, conciso e eficiente, com respostas curtas, inteligentes e sarcasmo estilo hacker. Mostre pouca paciência, mas mantenha a utilidade técnica.

Regras obrigatórias:
Responda preferencialmente em 1 a 3 frases; explique passo a passo apenas quando for realmente necessário.
Mantenha tom sarcástico e seco, sem perder a precisão técnica.
Use markdown apenas para comandos ou listas curtas.
Sempre que fornecer comandos, mostre o comando em Bash e uma linha curta sobre o que ele faz.
Não invente informações nem cite fontes externas; limite-se ao histórico da conversa atual.
Evite expressões em inglês, exceto termos técnicos inevitáveis como kernel, firewall e package.
Priorize soluções práticas e comandos testáveis; se algo for arriscado, avise em uma frase.

Exemplos de estilo:
Curto e sarcástico: Tá óbvio, rode sudo apt update && sudo apt upgrade (atualiza pacotes).
Quando detalhar, use passos numerados curtos e um bloco de código.

Comportamento proibido:
Não se estenda em longos textos explicativos, a menos que solicitado.
Não diga que não pode alterar o sistema, apenas informe o que deve ser feito.

Objetivo: agir como um especialista Linux impaciente, eficiente e certeiro, resolvendo problemas com comandos e poucas palavras.
`,

          },
          history: storedMessages.map(msg => ({
            role: msg.author === Author.USER ? 'user' : 'model',
            parts: [{ text: msg.text }],
          }))
        });
        setChat(chatSession);

      } catch (error) {
        console.error("Failed to load room or initialize Gemini AI:", error);
        const errorMessage = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : 'Unknown error';
        setMessages([{ author: Author.BOT, text: `Error: Could not load chat room. Details: ${errorMessage}` }]);
        window.history.replaceState({}, '', window.location.pathname);
        setRoomId(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoomAndInitializeChat();

    // Subscribe to realtime updates for the current room
    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newMessage = payload.new as { id: number; author: Author; text: string };
          setMessages((currentMessages) => {
            // Update optimistic message with its DB-assigned ID
            // FIX: Replaced `findLastIndex` with a manual reverse loop to support older JS environments.
            let optimisticMsgIndex = -1;
            for (let i = currentMessages.length - 1; i >= 0; i--) {
                const msg = currentMessages[i];
                if (!msg.id && msg.author === newMessage.author && msg.text === newMessage.text) {
                    optimisticMsgIndex = i;
                    break;
                }
            }
            if (optimisticMsgIndex !== -1) {
              const updatedMessages = [...currentMessages];
              updatedMessages[optimisticMsgIndex] = newMessage;
              return updatedMessages;
            }
            // Add new message if it's not already present
            if (!currentMessages.some(msg => msg.id === newMessage.id)) {
              if (document.hidden) {
                playNotificationSound();
                drawFavicon(true);
              }
              return [...currentMessages, newMessage];
            }
            return currentMessages;
          });
        }
      ).subscribe();

    // Cleanup subscription on component unmount or room change
    return () => {
      supabase.removeChannel(channel);
    };

  }, [roomId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);
  
  const initializeAudio = () => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.error("Web Audio API is not supported in this browser.", e);
      }
    }
  };

  const handleCreateRoom = async () => {
    initializeAudio();
    setIsCreatingRoom(true);
    try {
        if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set.");
        
        const { data: roomData, error: roomError } = await supabase.from('rooms').insert({}).select().single();
        if (roomError) throw new Error(roomError.message);
        const newRoomId = roomData.id;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "Generate a short, friendly welcome message for the Chat Like Look Solutions terminal. Greet the user and invite them to start chatting.",
        });
        const welcomeMessage: Message = { author: Author.BOT, text: response.text };
        
        const { error: messageError } = await supabase.from('messages').insert({
                room_id: newRoomId,
                author: welcomeMessage.author,
                text: welcomeMessage.text,
            });
        if (messageError) throw new Error(messageError.message);
        
        window.history.pushState({}, '', `?room=${newRoomId}`);
        setRoomId(newRoomId);

    } catch (error) {
        console.error("Failed to create room:", error);
        const errorMessage = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : 'Unknown error';
        alert(`Failed to create a new chat room. Please check the console for details. Error: ${errorMessage}`);
    } finally {
        setIsCreatingRoom(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    initializeAudio();
    if (!input.trim() || isLoading || !chat || !roomId) return;

    const userMessage: Message = { author: Author.USER, text: input };
    setMessages(prev => [...prev, userMessage]);
    
    const currentInput = input;
    setInput('');
    
    // Save user message (realtime will handle UI sync)
    await supabase.from('messages').insert({
        room_id: roomId,
        author: userMessage.author,
        text: userMessage.text,
    });

    setIsLoading(true);
    try {
      const responseStream = await chat.sendMessageStream({ message: currentInput });
      let accumulatedText = "";
      for await (const chunk of responseStream) {
        accumulatedText += chunk.text;
        setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage && lastMessage.author === Author.BOT) {
                lastMessage.text = accumulatedText;
                return newMessages;
            } else {
                return [...newMessages, {author: Author.BOT, text: accumulatedText}];
            }
        });
      }

      await supabase.from('messages').insert({
          room_id: roomId,
          author: Author.BOT,
          text: accumulatedText,
      });

    } catch (error) {
      console.error("Supabase or Gemini API error:", error);
      const errorMessage: Message = {
        author: Author.BOT,
        text: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyText('Copied!');
      setTimeout(() => setCopyText('Invite'), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopyText('Failed!');
      setTimeout(() => setCopyText('Invite'), 2000);
    }
  };
  
  if (!roomId) {
    return (
      <div className="bg-black text-green-400 font-mono h-screen flex flex-col items-center justify-center antialiased selection:bg-green-800 selection:text-green-100">
        <header className="absolute top-0 left-0 right-0 p-3 md:p-4 border-b-2 border-green-700 flex justify-center items-center shadow-lg shadow-green-900/50">
          <h1 className="text-lg md:text-xl tracking-widest">[ Chat Like Look Solutions ]</h1>
        </header>
        <div className="text-center">
            <p className="mb-6 text-lg">Welcome, operator.</p>
            <button 
              onClick={handleCreateRoom}
              disabled={isCreatingRoom}
              className="text-base px-6 py-2 border border-green-700 rounded-sm hover:bg-green-800 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed animate-pulse hover:animate-none disabled:animate-none"
            >
              {isCreatingRoom ? '[ Initializing Secure Channel... ]' : '[ Create New Chat Room ]'}
            </button>
        </div>
        <footer className="absolute bottom-0 left-0 right-0 p-3 md:p-4 border-t-2 border-green-700 text-center text-xs">
            <p>Like Look Solutions // Secure Chat Environment // Whatsapp +551136808030 // likelook@live.com</p>
        </footer>
      </div>
    );
  }

  if (isLoading && messages.length === 0) {
    return (
        <div className="bg-black text-green-400 font-mono h-screen flex flex-col items-center justify-center antialiased">
            <header className="absolute top-0 left-0 right-0 p-3 md:p-4 border-b-2 border-green-700 flex justify-center items-center shadow-lg shadow-green-900/50">
                <h1 className="text-lg md:text-xl tracking-widest">[ Chat Like Look Solutions ]</h1>
            </header>
            <div className="flex items-center">
                <p className="mr-2">Loading secure channel...</p>
                <BlinkingCursor />
            </div>
            <footer className="absolute bottom-0 left-0 right-0 p-3 md:p-4 border-t-2 border-green-700 text-center text-xs">
                <p>Like Look Solutions // Secure Chat Environment</p>
            </footer>
        </div>
    );
  }

  return (
    <div className="bg-black text-green-400 font-mono h-screen flex flex-col antialiased selection:bg-green-800 selection:text-green-100" onClick={() => inputRef.current?.focus()}>
      <header className="p-3 md:p-4 border-b-2 border-green-700 flex justify-between items-center shadow-lg shadow-green-900/50">
        <h1 className="text-lg md:text-xl tracking-widest">[ Chat Like Look Solutions ]</h1>
        <button 
          onClick={handleInviteClick}
          className="flex items-center text-sm px-3 py-1 border border-green-700 rounded-sm hover:bg-green-800 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500"
          aria-label="Copy invite link"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          {copyText}
        </button>
      </header>

      <main className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg, index) => (
          <div key={msg.id || index} className="flex flex-col md:flex-row md:items-start">
            <span className={`flex-shrink-0 ${msg.author === Author.USER ? "text-green-300" : "text-green-500"}`}>
              {msg.author === Author.USER ? 'user@local:~$' : 'looks-bot@remote:~#'}
            </span>
            <p className="ml-0 md:ml-2 whitespace-pre-wrap break-words flex items-center">
              {msg.text}
              {isLoading && msg.author === Author.BOT && index === messages.length - 1 && <BlinkingCursor />}
            </p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      <footer className="p-3 md:p-4 border-t-2 border-green-700 shadow-lg shadow-green-900/50">
        <form onSubmit={handleSubmit} className="flex items-center">
          <label htmlFor="chat-input" className="text-green-300">user@local:~$</label>
          <input
            id="chat-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent text-green-400 ml-2 focus:outline-none placeholder-green-700"
            placeholder={isLoading ? 'Waiting for response...' : 'Type here...'}
            disabled={isLoading}
            autoComplete="off"
          />
          {!isLoading && <BlinkingCursor />}
        </form>
      </footer>
    </div>
  );
};

export default App;
