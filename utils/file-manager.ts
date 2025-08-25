import { promises as fs } from 'fs';
import { join } from 'path';

const DATA_DIR = './data';

export class FileManager {
  static async ensureDataDir() {
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
  }

  static async readJson<T>(filename: string): Promise<T | null> {
    try {
      const filePath = join(DATA_DIR, filename);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.warn(`Failed to read ${filename}:`, error);
      return null;
    }
  }

  static async writeJson(filename: string, data: any): Promise<void> {
    try {
      await this.ensureDataDir();
      const filePath = join(DATA_DIR, filename);
      
      // Simple write for now - atomic writes can cause issues in Replit environment
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      
      console.log(`Successfully wrote ${filename}`);
    } catch (error) {
      console.error(`Failed to write ${filename}:`, error);
      throw error;
    }
  }

  static async appendToHistory(entry: any): Promise<void> {
    try {
      const history = (await this.readJson<any[]>('history.json')) || [];
      history.push(entry);
      
      // Keep only last 720 entries (30 days of hourly data)
      if (history.length > 720) {
        history.splice(0, history.length - 720);
      }
      
      await this.writeJson('history.json', history);
    } catch (error) {
      console.error('Failed to append to history:', error);
    }
  }
}