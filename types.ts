export enum Author {
  USER = 'user',
  BOT = 'bot',
}

export interface Message {
  id?: number;
  author: Author;
  text: string;
}