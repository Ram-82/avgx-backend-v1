import { FileManager } from '../utils/file-manager';
import { withRetry } from '../utils/retry';

interface FiatConfig {
  code: string;
  name: string;
  weight: number;
}

interface FiatData extends FiatConfig {
  rate: number;
}

interface ExchangeRateResponse {
  base: string;
  date: string;
  rates: { [key: string]: number };
}

class FiatApiService {
  private cachedRates: FiatData[] = [];
  private fiatConfig: FiatConfig[] = [];
  private lastFetch: Date | null = null;
  private readonly CACHE_DURATION = 60000; // 1 minute
  private readonly EXCHANGE_RATES_API_KEY = process.env.EXCHANGE_RATES_API_KEY;

  async initialize(): Promise<void> {
    this.fiatConfig = await FileManager.readJson<FiatConfig[]>('fiats.json') || [];
    console.log(`Loaded ${this.fiatConfig.length} fiat currencies from config`);
    console.log(`Exchange Rates API Key available: ${this.EXCHANGE_RATES_API_KEY ? 'Yes' : 'No'}`);
  }

  private shouldRefreshCache(): boolean {
    if (!this.lastFetch) return true;
    return Date.now() - this.lastFetch.getTime() > this.CACHE_DURATION;
  }

  async getFiatRatesWithWeights(): Promise<FiatData[]> {
    if (!this.fiatConfig.length) {
      await this.initialize();
    }

    if (!this.shouldRefreshCache() && this.cachedRates.length > 0) {
      return this.cachedRates;
    }

    return this.refreshRates();
  }

  async refreshRates(): Promise<FiatData[]> {
    return withRetry(async () => {
      const baseline = await FileManager.readJson<any>('baseline.json');
      
      try {
        // Use a simple, reliable free API
        const apiUrl = 'https://api.exchangerate-api.com/v4/latest/USD';
        console.log(`Fetching fiat rates from: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'AVGX-Backend/1.0'
          }
        });

        if (!response.ok) {
          throw new Error(`Exchange Rate API error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json() as any;
        console.log('API Response structure:', Object.keys(responseData || {}));
        
        if (!responseData || !responseData.rates || typeof responseData.rates !== 'object') {
          console.error('Invalid API response:', responseData);
          throw new Error('Invalid API response structure');
        }
        
        const rates = responseData.rates;
        console.log(`Found ${Object.keys(rates).length} rates in API response`);

        // Build rates array starting with USD
        this.cachedRates = [];
        const missingCurrencies: string[] = [];

        for (const config of this.fiatConfig) {
          if (config.code === 'USD') {
            this.cachedRates.push({
              ...config,
              rate: 1.0,
            });
          } else if (rates[config.code] && typeof rates[config.code] === 'number') {
            this.cachedRates.push({
              ...config,
              rate: rates[config.code],
            });
          } else {
            // Use baseline rate if available
            const baselineRate = baseline?.fiat_rates?.[config.code];
            if (baselineRate) {
              console.warn(`Using baseline rate for ${config.code}: ${baselineRate}`);
              this.cachedRates.push({
                ...config,
                rate: baselineRate,
              });
            } else {
              // For missing currencies, use a reasonable default based on similar currencies
              const defaultRate = this.getDefaultRateForCurrency(config.code);
              console.warn(`Using default rate for ${config.code}: ${defaultRate}`);
              this.cachedRates.push({
                ...config,
                rate: defaultRate,
              });
              missingCurrencies.push(config.code);
            }
          }
        }

        if (missingCurrencies.length > 0) {
          console.warn(`Missing rates for currencies: ${missingCurrencies.join(', ')}`);
        }

        console.log(`Successfully loaded ${this.cachedRates.length} fiat rates`);
        this.lastFetch = new Date();
        return this.cachedRates;
      } catch (error) {
        console.error('Failed to fetch fiat rates:', error);
        
        // Fallback to baseline data with defaults for missing currencies
        console.log('Using baseline fiat rates due to API failure');
        this.cachedRates = this.fiatConfig.map(config => {
          const baselineRate = baseline?.fiat_rates?.[config.code];
          if (baselineRate) {
            return {
              ...config,
              rate: baselineRate,
            };
          } else {
            // Use default rate for missing currencies
            const defaultRate = this.getDefaultRateForCurrency(config.code);
            console.warn(`Using default rate for ${config.code}: ${defaultRate}`);
            return {
            ...config,
              rate: defaultRate,
            };
          }
        });
        this.lastFetch = new Date();
          return this.cachedRates;
        }
    });
  }

  private getDefaultRateForCurrency(code: string): number {
    // Provide reasonable default rates for common currencies
    const defaultRates: { [key: string]: number } = {
      'EUR': 0.85,
      'CNY': 7.25,
      'JPY': 110,
      'GBP': 0.73,
      'INR': 75,
      'CAD': 1.25,
      'AUD': 1.35,
      'CHF': 0.90,
      'SEK': 8.5,
      'NOK': 8.8,
      'DKK': 6.2,
      'NZD': 1.45,
      'SGD': 1.35,
      'HKD': 7.8,
      'KRW': 1200,
      'BRL': 5.2,
      'RUB': 75,
      'ZAR': 15,
      'AED': 3.67,
      'SAR': 3.75,
      'TRY': 8.5,
      'MXN': 20,
      'THB': 32,
      'IDR': 14500,
      'MYR': 4.2,
      'PHP': 50,
      'PLN': 3.8,
      'HUF': 300,
      'CZK': 22,
      'CLP': 800,
      'COP': 3800,
      'ILS': 3.2,
      'EGP': 15.7,
      'PKR': 160,
      'NGN': 410,
      'KES': 110,
      'BDT': 85,
      'VND': 23000,
      'ARS': 100,
      'PEN': 3.7,
      'QAR': 3.64,
      'KWD': 0.30,
      'BHD': 0.38,
      'OMR': 0.38,
      'MAD': 9.2,
      'TND': 2.8,
      'UAH': 27,
      'LKR': 200,
      'RON': 4.2,
      'BGN': 1.65,
      'HRK': 6.5,
    };
    
    return defaultRates[code] || 1.0; // Default to 1.0 if no specific rate found
  }

  getWeightedFiatAverage(): number {
    if (this.cachedRates.length === 0) {
      throw new Error('No fiat rate data available');
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const fiat of this.cachedRates) {
      // Use inverse rate to get USD value (since API returns rates FROM USD)
      const usdValue = fiat.code === 'USD' ? 1.0 : 1.0 / fiat.rate;
      weightedSum += usdValue * fiat.weight;
      totalWeight += fiat.weight;
    }

    if (totalWeight === 0) {
      throw new Error('Invalid fiat weights');
    }

    return weightedSum / totalWeight;
  }

  getAllFiatRates(): FiatData[] {
    return this.cachedRates;
  }

  getMissingCurrencies(): string[] {
    const configCodes = this.fiatConfig.map(f => f.code);
    const cachedCodes = this.cachedRates.map(r => r.code);
    return configCodes.filter(code => !cachedCodes.includes(code));
  }
}

export const fiatApiService = new FiatApiService();