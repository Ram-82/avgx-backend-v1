import { FileManager } from '../utils/file-manager';
import { withRetry } from '../utils/retry';

interface CryptoConfig {
  id: string;
  symbol: string;
  name: string;
  weight: number;
}

interface CryptoData extends CryptoConfig {
  price: number;
  marketCap?: number;
}

interface CoinGeckoResponse {
  [key: string]: {
    usd: number;
    usd_market_cap?: number;
    usd_24h_change?: number;
  };
}

class CryptoApiService {
  private cachedPrices: CryptoData[] = [];
  private cryptoConfig: CryptoConfig[] = [];
  private lastFetch: Date | null = null;
  private readonly CACHE_DURATION = 60000; // 1 minute

  async initialize(): Promise<void> {
    this.cryptoConfig = await FileManager.readJson<CryptoConfig[]>('cryptos.json') || [];
    console.log(`Loaded ${this.cryptoConfig.length} cryptocurrencies from config`);
  }

  private shouldRefreshCache(): boolean {
    if (!this.lastFetch) return true;
    return Date.now() - this.lastFetch.getTime() > this.CACHE_DURATION;
  }

  async getCryptoPricesWithWeights(): Promise<CryptoData[]> {
    if (!this.cryptoConfig.length) {
      await this.initialize();
    }

    if (!this.shouldRefreshCache() && this.cachedPrices.length > 0) {
      return this.cachedPrices;
    }

    return this.refreshPrices();
  }

  async refreshPrices(): Promise<CryptoData[]> {
    return withRetry(async () => {
      const baseline = await FileManager.readJson<any>('baseline.json');
      
      try {
        const coinIds = this.cryptoConfig.map(c => c.id).join(',');
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`
        );

        if (!response.ok) {
          throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as CoinGeckoResponse;
        
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid CoinGecko response structure');
        }

        this.cachedPrices = [];
        const missingCryptos: string[] = [];

        for (const config of this.cryptoConfig) {
          const apiData = data[config.id];
          if (apiData && typeof apiData.usd === 'number') {
            this.cachedPrices.push({
              ...config,
              price: apiData.usd,
              marketCap: apiData.usd_market_cap,
            });
          } else {
            // Use baseline price if available
            const baselinePrice = baseline?.crypto_prices?.[config.id];
            if (baselinePrice) {
              console.warn(`Using baseline price for ${config.id}: $${baselinePrice}`);
              this.cachedPrices.push({
                ...config,
                price: baselinePrice,
                marketCap: undefined,
              });
            } else {
              missingCryptos.push(config.id);
            }
          }
        }

        if (missingCryptos.length > 0) {
          console.warn(`Missing prices for cryptocurrencies: ${missingCryptos.join(', ')}`);
        }

        // Update baseline with current prices
        const cryptoPricesForBaseline = this.cachedPrices.reduce((acc, crypto) => {
          acc[crypto.id] = crypto.price;
          return acc;
        }, {} as { [key: string]: number });

        if (baseline) {
          baseline.crypto_prices = { ...baseline.crypto_prices, ...cryptoPricesForBaseline };
          baseline.timestamp = new Date().toISOString();
          await FileManager.writeJson('baseline.json', baseline);
        }

        this.lastFetch = new Date();
        console.log(`Fetched prices for ${this.cachedPrices.length}/${this.cryptoConfig.length} cryptocurrencies`);
        
        return this.cachedPrices;
      } catch (error) {
        // Fallback to baseline data
        if (baseline?.crypto_prices) {
          console.warn('Falling back to baseline crypto prices');
          this.cachedPrices = this.cryptoConfig.map(config => ({
            ...config,
            price: baseline.crypto_prices[config.id] || 1.0,
            marketCap: undefined,
          }));
          return this.cachedPrices;
        }
        throw error;
      }
    }, { maxAttempts: 3 });
  }

  getWeightedCryptoAverage(): number {
    if (this.cachedPrices.length === 0) {
      throw new Error('No crypto price data available');
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const crypto of this.cachedPrices) {
      weightedSum += crypto.price * crypto.weight;
      totalWeight += crypto.weight;
    }

    if (totalWeight === 0) {
      throw new Error('Invalid crypto weights');
    }

    return weightedSum / totalWeight;
  }

  getAllCryptoPrices(): CryptoData[] {
    return this.cachedPrices;
  }

  getMissingCryptos(): string[] {
    const configIds = this.cryptoConfig.map(c => c.id);
    const cachedIds = this.cachedPrices.map(p => p.id);
    return configIds.filter(id => !cachedIds.includes(id));
  }
}

export const cryptoApiService = new CryptoApiService();