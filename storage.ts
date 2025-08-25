import { type User, type InsertUser, type Contact, type InsertContact, type AvgxIndex, type FiatRate, type CryptoPrice, type AvgxTransaction, type InsertTransaction, type AvgxReserves, type InsertReserves } from "@shared/schema";
import { randomUUID } from "crypto";

// Extended storage interface for AVGX data
export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Contact operations
  createContact(contact: InsertContact): Promise<Contact>;
  getAllContacts(): Promise<Contact[]>;
  
  // AVGX index operations
  storeAvgxIndex(index: Omit<AvgxIndex, 'id'>): Promise<AvgxIndex>;
  getLatestAvgxIndex(): Promise<AvgxIndex | undefined>;
  getAvgxIndexHistory(limit?: number): Promise<AvgxIndex[]>;
  
  // Fiat rate operations
  storeFiatRates(rates: Omit<FiatRate, 'id'>[]): Promise<FiatRate[]>;
  getLatestFiatRates(): Promise<FiatRate[]>;
  
  // Crypto price operations
  storeCryptoPrices(prices: Omit<CryptoPrice, 'id'>[]): Promise<CryptoPrice[]>;
  getLatestCryptoPrices(): Promise<CryptoPrice[]>;
  
  // AVGX Coin transaction operations
  createTransaction(transaction: InsertTransaction): Promise<AvgxTransaction>;
  getTransactionHistory(walletAddress: string, limit?: number): Promise<AvgxTransaction[]>;
  getAllTransactions(): Promise<AvgxTransaction[]>;
  
  // AVGX reserves operations
  updateReserves(reserves: InsertReserves): Promise<AvgxReserves>;
  getLatestReserves(): Promise<AvgxReserves | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private contacts: Map<string, Contact>;
  private avgxIndices: Map<string, AvgxIndex>;
  private fiatRates: Map<string, FiatRate>;
  private cryptoPrices: Map<string, CryptoPrice>;
  private transactions: Map<string, AvgxTransaction>;
  private reserves: Map<string, AvgxReserves>;

  constructor() {
    this.users = new Map();
    this.contacts = new Map();
    this.avgxIndices = new Map();
    this.fiatRates = new Map();
    this.cryptoPrices = new Map();
    this.transactions = new Map();
    this.reserves = new Map();
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Contact operations
  async createContact(insertContact: InsertContact): Promise<Contact> {
    const id = randomUUID();
    const contact: Contact = { 
      ...insertContact, 
      id, 
      createdAt: new Date() 
    };
    this.contacts.set(id, contact);
    return contact;
  }

  async getAllContacts(): Promise<Contact[]> {
    return Array.from(this.contacts.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // AVGX index operations
  async storeAvgxIndex(indexData: Omit<AvgxIndex, 'id'>): Promise<AvgxIndex> {
    const id = randomUUID();
    const index: AvgxIndex = { ...indexData, id };
    this.avgxIndices.set(id, index);
    return index;
  }

  async getLatestAvgxIndex(): Promise<AvgxIndex | undefined> {
    const indices = Array.from(this.avgxIndices.values());
    if (indices.length === 0) return undefined;
    
    return indices.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  }

  async getAvgxIndexHistory(limit: number = 100): Promise<AvgxIndex[]> {
    return Array.from(this.avgxIndices.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // Fiat rate operations
  async storeFiatRates(rates: Omit<FiatRate, 'id'>[]): Promise<FiatRate[]> {
    const storedRates: FiatRate[] = [];
    
    for (const rate of rates) {
      const id = randomUUID();
      const fiatRate: FiatRate = { ...rate, id };
      this.fiatRates.set(id, fiatRate);
      storedRates.push(fiatRate);
    }
    
    return storedRates;
  }

  async getLatestFiatRates(): Promise<FiatRate[]> {
    const rates = Array.from(this.fiatRates.values());
    
    // Group by currency and get the latest for each
    const latestRates = new Map<string, FiatRate>();
    
    for (const rate of rates) {
      const existing = latestRates.get(rate.currency);
      if (!existing || new Date(rate.timestamp) > new Date(existing.timestamp)) {
        latestRates.set(rate.currency, rate);
      }
    }
    
    return Array.from(latestRates.values());
  }

  // Crypto price operations
  async storeCryptoPrices(prices: Omit<CryptoPrice, 'id'>[]): Promise<CryptoPrice[]> {
    const storedPrices: CryptoPrice[] = [];
    
    for (const price of prices) {
      const id = randomUUID();
      const cryptoPrice: CryptoPrice = { ...price, id };
      this.cryptoPrices.set(id, cryptoPrice);
      storedPrices.push(cryptoPrice);
    }
    
    return storedPrices;
  }

  async getLatestCryptoPrices(): Promise<CryptoPrice[]> {
    const prices = Array.from(this.cryptoPrices.values());
    
    // Group by symbol and get the latest for each
    const latestPrices = new Map<string, CryptoPrice>();
    
    for (const price of prices) {
      const existing = latestPrices.get(price.symbol);
      if (!existing || new Date(price.timestamp) > new Date(existing.timestamp)) {
        latestPrices.set(price.symbol, price);
      }
    }
    
    return Array.from(latestPrices.values());
  }

  // AVGX Coin transaction operations
  async createTransaction(insertTransaction: InsertTransaction): Promise<AvgxTransaction> {
    const id = randomUUID();
    const transaction: AvgxTransaction = { 
      ...insertTransaction, 
      id, 
      timestamp: new Date() 
    };
    this.transactions.set(id, transaction);
    return transaction;
  }

  async getTransactionHistory(walletAddress: string, limit: number = 50): Promise<AvgxTransaction[]> {
    return Array.from(this.transactions.values())
      .filter(tx => tx.walletAddress === walletAddress)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async getAllTransactions(): Promise<AvgxTransaction[]> {
    return Array.from(this.transactions.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // AVGX reserves operations
  async updateReserves(insertReserves: InsertReserves): Promise<AvgxReserves> {
    const id = randomUUID();
    const reserves: AvgxReserves = { 
      ...insertReserves, 
      id, 
      timestamp: new Date() 
    };
    this.reserves.set(id, reserves);
    return reserves;
  }

  async getLatestReserves(): Promise<AvgxReserves | undefined> {
    const reservesList = Array.from(this.reserves.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return reservesList.length > 0 ? reservesList[0] : undefined;
  }
}

export const storage = new MemStorage();
