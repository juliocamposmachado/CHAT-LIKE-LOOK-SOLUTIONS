import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { Message, Author } from './types';

// A simple component for the blinking cursor effect.
const BlinkingCursor: React.FC = () => (
  <div className="w-2 h-5 bg-green-400 animate-pulse ml-1" />
);

// The main application component.
const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [copyText, setCopyText] = useState<string>('Invite');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Function to scroll to the latest message.
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Effect to scroll down when new messages are added.
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Effect to initialize the Gemini chat session and get a welcome message on component mount.
  useEffect(() => {
    const initializeChat = async () => {
      setIsLoading(true);
      try {
        if (!process.env.API_KEY) {
          throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chatSession = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: {
            systemInstruction: 'You are a helpful AI assistant in a retro-terminal chat application called Chat Like Look Solutions. Your responses should be concise, helpful, and fit the terminal aesthetic. Use markdown for formatting if necessary.',
          },
        });
        setChat(chatSession);
        
        const response = await chatSession.sendMessage({ message: "Generate a short, friendly welcome message for the Chat Like Look Solutions terminal. Greet the user and invite them to start chatting." });
        const welcomeMessage: Message = { author: Author.BOT, text: response.text };
        setMessages([welcomeMessage]);

      } catch (error) {
        console.error("Failed to initialize Gemini AI:", error);
        setMessages([
          { author: Author.BOT, text: `Error: Could not connect to the AI service. Details: ${error instanceof Error ? error.message : 'Unknown error'}` },
        ]);
      } finally {
        setIsLoading(false);
      }
    };
    initializeChat();
  }, []);
  
  // Effect to focus the input field when the app loads or after a bot response.
  useEffect(() => {
      if (!isLoading) {
          inputRef.current?.focus();
      }
  }, [isLoading]);


  // Handler for form submission.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !chat) return;

    const userMessage: Message = { author: Author.USER, text: input };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
      const response = await chat.sendMessage({ message: currentInput });
      const botMessage: Message = { author: Author.BOT, text: response.text };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error("Gemini API error:", error);
      const errorMessage: Message = {
        author: Author.BOT,
        text: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

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


  return (
    <div className="bg-black text-green-400 font-mono h-screen flex flex-col antialiased selection:bg-green-800 selection:text-green-100" onClick={() => inputRef.current?.focus()}>
      <header className="p-3 md:p-4 border-b-2 border-green-700 flex justify-between items-center shadow-lg shadow-green-900/50">
        <h1 className="text-lg md:text-xl tracking-widest">[ Chat Like Look Solutions ]</h1>
        <button 
          onClick={handleInviteClick}
          className="flex items-center text-sm px-3 py-1 border border-green-700 rounded-sm hover:bg-green-800 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500"
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
            <p className="ml-0 md:ml-2 whitespace-pre-wrap break-words">{msg.text}</p>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center">
            <span className="text-green-500">looks-bot@remote:~#</span>
            <div className="ml-2 flex items-center">
              <span className="animate-pulse">.</span>
              <span className="animate-pulse" style={{ animationDelay: '75ms' }}>.</span>
              <span className="animate-pulse" style={{ animationDelay: '150ms' }}>.</span>
            </div>
          </div>
        )}
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