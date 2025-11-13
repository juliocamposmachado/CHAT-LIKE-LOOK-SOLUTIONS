
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

  // On initial load, check URL for a room ID.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('room');
    if (id) {
      setRoomId(id);
    }
  }, []);

  // Load a room from Supabase and initialize the chat session.
  useEffect(() => {
    const loadRoomAndInitializeChat = async () => {
      if (!roomId) return;

      setIsLoading(true);
      try {
        // Fetch chat history from Supabase
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        if (messageError) throw new Error(messageError.message);
        
        // If no messages, check if room exists but is empty. If room doesn't exist, this will throw.
        if (messageData.length === 0) {
            const { error: roomError } = await supabase
                .from('rooms')
                .select('id')
                .eq('id', roomId)
                .single();
            
            if (roomError) {
                throw new Error(`Chat room not found or invalid.`);
            }
        }

        const storedMessages: Message[] = messageData.map(msg => ({ author: msg.author as Author, text: msg.text }));
        setMessages(storedMessages);

        // Initialize Gemini AI
        if (!process.env.API_KEY) {
          throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chatSession = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: {
            systemInstruction: 'You are an AI assistant in a retro-terminal chat application called "Chat Like Look Solutions". Your persona is that of a terminal-based bot. Your knowledge is strictly limited to the current conversation\'s history. Respond only with information from this chat. Be concise, helpful, and maintain the terminal aesthetic. Use markdown for formatting where appropriate.',
          },
          // Prime the chat session with the loaded history
          history: storedMessages.map(msg => ({
            role: msg.author === Author.USER ? 'user' : 'model',
            parts: [{ text: msg.text }],
          }))
        });
        setChat(chatSession);

      } catch (error) {
        console.error("Failed to load room or initialize Gemini AI:", error);
        const errorMessage = (error && typeof error === 'object' && 'message' in error) 
          ? String(error.message) 
          : 'Unknown error';
        setMessages([
          { author: Author.BOT, text: `Error: Could not load chat room. Details: ${errorMessage}` },
        ]);
        // Clear the invalid room from the URL and state to return to lobby
        window.history.replaceState({}, '', window.location.pathname);
        setRoomId(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoomAndInitializeChat();
  }, [roomId]);

  // Function to scroll to the latest message.
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Effect to scroll down when new messages are added or updated.
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Effect to focus the input field when the app loads or after a bot response.
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);
  
  // Handler for creating a new room in Supabase
  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    try {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        
        // 1. Create a new room in Supabase
        const { data: roomData, error: roomError } = await supabase
            .from('rooms')
            .insert({})
            .select()
            .single();

        if (roomError) throw new Error(roomError.message);
        const newRoomId = roomData.id;

        // 2. Get a welcome message from the AI
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "Generate a short, friendly welcome message for the Chat Like Look Solutions terminal. Greet the user and invite them to start chatting.",
        });

        const welcomeMessage: Message = { author: Author.BOT, text: response.text };
        
        // 3. Save the initial message to the new room
        const { error: messageError } = await supabase
            .from('messages')
            .insert({
                room_id: newRoomId,
                author: welcomeMessage.author,
                text: welcomeMessage.text,
            });
        
        if (messageError) throw new Error(messageError.message);
        
        // 4. Update the browser URL and app state to enter the new room
        window.history.pushState({}, '', `?room=${newRoomId}`);
        setRoomId(newRoomId);

    } catch (error) {
        console.error("Failed to create room:", error);
        const errorMessage = (error && typeof error === 'object' && 'message' in error) 
          ? String(error.message) 
          : 'Unknown error';
        alert(`Failed to create a new chat room. Please check the console for details. Error: ${errorMessage}`);
    } finally {
        setIsCreatingRoom(false);
    }
  };

  // Handler for form submission to send a message and stream the response.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !chat || !roomId) return;

    const userMessage: Message = { author: Author.USER, text: input };
    const messagesBeforeResponse = [...messages, userMessage];

    // Optimistically update UI with user message and bot placeholder
    setMessages([...messagesBeforeResponse, { author: Author.BOT, text: '' }]);
    
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
      // 1. Save user message to Supabase
      const { error: userMessageError } = await supabase.from('messages').insert({
          room_id: roomId,
          author: userMessage.author,
          text: userMessage.text,
      });
      if (userMessageError) throw new Error(userMessageError.message);

      const responseStream = await chat.sendMessageStream({ message: currentInput });
      let accumulatedText = "";
      for await (const chunk of responseStream) {
        accumulatedText += chunk.text;
        // Update the UI with the streaming response
        setMessages([...messagesBeforeResponse, { author: Author.BOT, text: accumulatedText }]);
      }

      // After the stream is complete, save the new full history to Supabase
      const { error: botMessageError } = await supabase.from('messages').insert({
          room_id: roomId,
          author: Author.BOT,
          text: accumulatedText,
      });
      if (botMessageError) throw new Error(botMessageError.message);

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

  // Handler for the invite button
  const handleInviteClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyText('Copied!');
      setTimeout(() => setCopyText('Invite'), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopyText('Failed!');
      setTimeout(() => setCopyText('Invite'), 2000);
    }
  };
  
  // Render lobby if not in a room
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
            <p>Look Solutions // Secure Chat Environment</p>
        </footer>
      </div>
    );
  }

  // Render loading state while fetching room data for the first time
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
                <p>Look Solutions // Secure Chat Environment</p>
            </footer>
        </div>
    );
  }

  // Render chat UI if in a room
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
          <div key={index} className="flex flex-col md:flex-row md:items-start">
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
