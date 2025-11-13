
import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { Message, Author } from './types';

// A simple component for the blinking cursor effect.
const BlinkingCursor: React.FC = () => (
  <div className="w-2 h-5 bg-green-400 animate-pulse ml-1" />
);

/**
 * Saves the chat history to dpaste.org and returns the new snippet ID.
 * @param messages The array of messages to save.
 * @returns A promise that resolves to the new dpaste snippet ID.
 */
const saveChatHistory = async (messages: Message[]): Promise<string> => {
  const formData = new FormData();
  formData.append('content', JSON.stringify(messages, null, 2));
  formData.append('format', 'json');
  formData.append('lexer', 'json');
  formData.append('expires', '2592000'); // Expires in 1 month

  const response = await fetch('https://dpaste.org/api/', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to save to dpaste: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.url) {
    throw new Error('dpaste.org API did not return a URL.');
  }
  // Extract the snippet ID from the full URL (e.g., "EBKU" from "https://dpaste.org/EBKU")
  const snippetId = data.url.substring(data.url.lastIndexOf('/') + 1);
  return snippetId;
};


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

  // Load a room from dpaste.org and initialize the chat session.
  useEffect(() => {
    const loadRoomAndInitializeChat = async () => {
      if (!roomId) return;

      setIsLoading(true);
      try {
        // Fetch chat history from the raw dpaste URL
        const response = await fetch(`https://dpaste.org/${roomId}/raw`);
        if (!response.ok) {
          throw new Error(`Chat room not found or expired.`);
        }
        const historyText = await response.text();
        const storedMessages: Message[] = JSON.parse(historyText);
        setMessages(storedMessages);

        // Initialize Gemini AI
        if (!process.env.API_KEY) {
          throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chatSession = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: {
            systemInstruction: 'You are a helpful AI assistant in a retro-terminal chat application called Chat Like Look Solutions. Your responses should be concise, helpful, and fit the terminal aesthetic. Use markdown for formatting if necessary.',
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
        setMessages([
          { author: Author.BOT, text: `Error: Could not load chat room. Details: ${error instanceof Error ? error.message : 'Unknown error'}` },
        ]);
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
  
  // Handler for creating a new room by saving an initial message to dpaste.org
  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    try {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // Get a welcome message from the AI
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "Generate a short, friendly welcome message for the Chat Like Look Solutions terminal. Greet the user and invite them to start chatting.",
        });

        const welcomeMessage: Message = { author: Author.BOT, text: response.text };
        const initialMessages = [welcomeMessage];
        
        // Save the initial message to dpaste to create the room
        const newSnippetId = await saveChatHistory(initialMessages);
        
        // Update the browser URL and app state to enter the new room
        window.history.pushState({}, '', `?room=${newSnippetId}`);
        setRoomId(newSnippetId);

    } catch (error) {
        console.error("Failed to create room:", error);
        alert(`Failed to create a new chat room. Please check the console for details. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        setIsCreatingRoom(false);
    }
  };

  // Handler for form submission to send a message and stream the response.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !chat) return;

    const userMessage: Message = { author: Author.USER, text: input };
    const messagesBeforeResponse = [...messages, userMessage];

    // Optimistically update UI with user message and bot placeholder
    setMessages([...messagesBeforeResponse, { author: Author.BOT, text: '' }]);
    
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
      const responseStream = await chat.sendMessageStream({ message: currentInput });
      let accumulatedText = "";
      for await (const chunk of responseStream) {
        accumulatedText += chunk.text;
        // Update the UI with the streaming response
        setMessages([...messagesBeforeResponse, { author: Author.BOT, text: accumulatedText }]);
      }

      // After the stream is complete, save the new full history to dpaste
      const finalMessages = [...messagesBeforeResponse, { author: Author.BOT, text: accumulatedText }];
      const newSnippetId = await saveChatHistory(finalMessages);
      
      // Update the URL and roomId to point to the new snippet, preserving the chat state
      window.history.pushState({}, '', `?room=${newSnippetId}`);
      setRoomId(newSnippetId);

    } catch (error) {
      console.error("Gemini API or dpaste error:", error);
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
