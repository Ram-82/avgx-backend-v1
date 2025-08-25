import { cryptoApiService } from './crypto-api';
import { fiatApiService } from './fiat-api';
import { FileManager } from '../utils/file-manager';

export interface AvgxCalculationResult {
  avgx_usd: number;
  wf_value: number;
  wc_value: number;
  change24h: number;
  timestamp: string;
}

export interface HistoryEntry {
  timestamp: string;
  avgx_usd: number;
  wf_value: number;
  wc_value: number;
}

// Configuration parameters for the stability formula
interface StabilityConfig {
  alpha_f: number;      // Smoothing factor for fiat (default: 0.2)
  alpha_c: number;      // Smoothing factor for crypto (default: 0.1)
  v_target: number;     // Target volatility percentage (default: 10%)
  clamp_percent: number; // Daily movement clamp percentage (default: 1.5%)
  volatility_window: number; // Rolling window for volatility calculation (default: 30)
}

interface SmoothedValues {
  wf_smoothed: number;
  wc_smoothed: number;
  volatility_index: number;
  wc_adjusted: number;
}

class AvgxCalculatorService {
  private static instance: AvgxCalculatorService;
  private config: StabilityConfig = {
    alpha_f: 0.2,
    alpha_c: 0.1, 
    v_target: 0.10,
    clamp_percent: 0.015,
    volatility_window: 30
  };
  private readonly CACHE_DURATION = 60000; // 1 minute
  private lastCalculation: AvgxCalculationResult | null = null;


  public static getInstance(): AvgxCalculatorService {
    if (!AvgxCalculatorService.instance) {
      AvgxCalculatorService.instance = new AvgxCalculatorService();
    }
    return AvgxCalculatorService.instance;
  }

  /**
   * Calculates the current AVGX value using the stability formula:
   * AVGX(t) = sqrt( WF_smoothed(t) * ( WC_smoothed(t) * (1 - σ_t) ) )
   * where σ_t is a volatility index adjustment in [0,1]
   */
  async calculateAvgxIndex(): Promise<AvgxCalculationResult> {
    try {
      // Initialize services if needed
      await Promise.all([
        fiatApiService.initialize(),
        cryptoApiService.initialize()
      ]);

      // Get weighted averages for both baskets
      const [fiatData, cryptoData] = await Promise.all([
        fiatApiService.getFiatRatesWithWeights(),
        cryptoApiService.getCryptoPricesWithWeights()
      ]);

      const wfValue = fiatApiService.getWeightedFiatAverage();
      const wcValue = cryptoApiService.getWeightedCryptoAverage();

      // Calculate AVGX using the mathematical formula
      const avgxValue = Math.sqrt(wfValue * wcValue);

      // Get historical data for 24h change calculation
      const history = await this.getHistoricalData('24h');
      let change24h = 0;

      if (history.length > 0) {
        const dayAgo = history[0];
        if (dayAgo && dayAgo.avgx_usd > 0) {
          change24h = ((avgxValue - dayAgo.avgx_usd) / dayAgo.avgx_usd) * 100;
        }
      }

      const result: AvgxCalculationResult = {
        avgx_usd: avgxValue,
        wf_value: wfValue,
        wc_value: wcValue,
        change24h,
        timestamp: new Date().toISOString(),
      };

      this.lastCalculation = result;

      // Save to history (every hour to avoid too much data)
      const now = new Date();
      const shouldSaveHistory = now.getMinutes() === 0; // Save at the top of each hour

      if (shouldSaveHistory) {
        await FileManager.appendToHistory({
          timestamp: result.timestamp,
          avgx_usd: result.avgx_usd,
          wf_value: result.wf_value,
          wc_value: result.wc_value,
        });
      }

      // Update baseline
      const baseline = await FileManager.readJson<any>('baseline.json') || {};
      baseline.avgx_value = result.avgx_usd;
      baseline.wf_value = result.wf_value;
      baseline.wc_value = result.wc_value;
      baseline.timestamp = result.timestamp;
      await FileManager.writeJson('baseline.json', baseline);

      console.log(`AVGX calculated: $${avgxValue.toFixed(4)} (WF: ${wfValue.toFixed(4)}, WC: $${wcValue.toFixed(2)})`);

      return result;
    } catch (error) {
      console.error('Failed to calculate AVGX index:', error);

      // Fallback to baseline
      const baseline = await FileManager.readJson<any>('baseline.json');
      if (baseline?.avgx_value) {
        console.warn('Falling back to baseline AVGX value');
        return {
          avgx_usd: baseline.avgx_value,
          wf_value: baseline.wf_value || 1.0,
          wc_value: baseline.wc_value || 62500.0,
          change24h: 0,
          timestamp: new Date().toISOString(),
        };
      }

      throw new Error('Failed to calculate AVGX index');
    }
  }

  /**
   * Get current AVGX calculation with caching
   */
  async getCurrentAvgx(): Promise<{
    avgx_usd: number;
    wf_value: number;
    wc_value: number;
    change24h: number;
    timestamp: string;
  }> {
    try {
      const [fiatRates, cryptoPrices] = await Promise.all([
        fiatApiService.getFiatRatesWithWeights(),
        cryptoApiService.getCryptoPricesWithWeights()
      ]);

      // Calculate raw weighted baskets
      const wfRaw = fiatRates.reduce((sum, fiat) => sum + (fiat.rate * fiat.weight), 0);
      const wcRaw = cryptoPrices.reduce((sum, crypto) => sum + (crypto.price * crypto.weight), 0);

      // Apply stability formula
      const smoothedValues = await this.calculateSmoothedValues(wfRaw, wcRaw);

      // AVGX = sqrt(WF_smoothed * WC_adjusted)
      const avgxValue = Math.sqrt(smoothedValues.wf_smoothed * smoothedValues.wc_adjusted);

      // Apply daily movement clamp
      const clampedAvgxValue = await this.applyDailyClamp(avgxValue);

      // Calculate 24h change (simplified - would need historical data for accuracy)
      const change24h = 0; // TODO: Implement with historical data

      const result = {
        avgx_usd: clampedAvgxValue,
        wf_value: smoothedValues.wf_smoothed,
        wc_value: smoothedValues.wc_adjusted,
        change24h,
        timestamp: new Date().toISOString()
      };

      console.log(`AVGX calculated: $${clampedAvgxValue.toFixed(4)} (WF: ${smoothedValues.wf_smoothed.toFixed(4)}, WC: $${smoothedValues.wc_adjusted.toFixed(2)}, σ: ${smoothedValues.volatility_index.toFixed(4)})`);

      // Store current values for smoothing history
      await this.storeSmoothedValues(smoothedValues, clampedAvgxValue);

      return result;
    } catch (error) {
      console.error('Error calculating AVGX:', error);
      throw error;
    }
  }

  private shouldRefreshCache(): boolean {
    if (!this.lastCalculation) return true;
    return Date.now() - new Date(this.lastCalculation.timestamp).getTime() > this.CACHE_DURATION;
  }

  /**
   * Get detailed breakdown of the AVGX calculation
   */
  async getDetailedBreakdown() {
    const [fiatData, cryptoData, avgxResult] = await Promise.all([
      fiatApiService.getFiatRatesWithWeights(),
      cryptoApiService.getCryptoPricesWithWeights(),
      this.getCurrentAvgx()
    ]);

    return {
      avgx: avgxResult,
      fiatBasket: fiatData,
      cryptoBasket: cryptoData,
    };
  }

  /**
   * Get historical AVGX data
   */
  async getHistoricalData(timeframe: '24h' | '7d' | '30d'): Promise<HistoryEntry[]> {
    const history = await FileManager.readJson<HistoryEntry[]>('history.json') || [];

    const now = new Date();
    let cutoffDate: Date;

    switch (timeframe) {
      case '24h':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return history
      .filter(entry => new Date(entry.timestamp) >= cutoffDate)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Convert AVGX to all fiat currencies
   */
  async convertToAllCurrencies(): Promise<Array<{ currency: string; name: string; rate: number; avgx_rate: number }>> {
    const [avgxData, fiatData] = await Promise.all([
      this.getCurrentAvgx(),
      fiatApiService.getFiatRatesWithWeights()
    ]);

    return fiatData.map(fiat => ({
      currency: fiat.code,
      name: fiat.name,
      rate: fiat.rate,
      avgx_rate: avgxData.avgx_usd * fiat.rate, // 1 AVGX = X currency units
    }));
  }

  /**
   * Calculates smoothed values and volatility index according to stability formula
   */
  private async calculateSmoothedValues(wfRaw: number, wcRaw: number): Promise<SmoothedValues> {
    try {
      // Get previous smoothed values from storage
      const history = await this.getSmoothedHistory();
      const lastSmoothed = history.length > 0 ? history[history.length - 1] : null;

      // Apply EWMA smoothing
      const wfSmoothed = lastSmoothed 
        ? this.config.alpha_f * wfRaw + (1 - this.config.alpha_f) * lastSmoothed.wf_smoothed
        : wfRaw;

      const wcSmoothed = lastSmoothed
        ? this.config.alpha_c * wcRaw + (1 - this.config.alpha_c) * lastSmoothed.wc_smoothed  
        : wcRaw;

      // Calculate volatility index σ_t
      const volatilityIndex = await this.calculateVolatilityIndex(wcSmoothed, history);

      // Apply volatility adjustment to crypto component
      const wcAdjusted = wcSmoothed * (1 - volatilityIndex);

      return {
        wf_smoothed: wfSmoothed,
        wc_smoothed: wcSmoothed,
        volatility_index: volatilityIndex,
        wc_adjusted: wcAdjusted
      };
    } catch (error) {
      console.error('Error calculating smoothed values:', error);
      // Fallback to raw values if smoothing fails
      return {
        wf_smoothed: wfRaw,
        wc_smoothed: wcRaw,
        volatility_index: 0,
        wc_adjusted: wcRaw
      };
    }
  }

  /**
   * Calculates volatility index σ_t based on 30-day rolling window
   */
  private async calculateVolatilityIndex(wcSmoothed: number, history: any[]): Promise<number> {
    try {
      if (history.length < 2) return 0;

      // Get recent WC smoothed values for volatility calculation
      const recentValues = history
        .slice(-this.config.volatility_window)
        .map(h => h.wc_smoothed)
        .concat([wcSmoothed]);

      if (recentValues.length < 2) return 0;

      // Calculate log returns
      const logReturns = [];
      for (let i = 1; i < recentValues.length; i++) {
        const logReturn = Math.log(recentValues[i] / recentValues[i - 1]);
        logReturns.push(logReturn);
      }

      if (logReturns.length === 0) return 0;

      // Calculate standard deviation of log returns
      const mean = logReturns.reduce((sum, val) => sum + val, 0) / logReturns.length;
      const variance = logReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / logReturns.length;
      const stdDev = Math.sqrt(variance);

      // Annualize volatility (assuming daily data points)
      const annualizedVol = stdDev * Math.sqrt(365);

      // Calculate volatility index: σ_t = min(1, σ_annualized / V_target)
      const volatilityIndex = Math.min(1, annualizedVol / this.config.v_target);

      return volatilityIndex;
    } catch (error) {
      console.error('Error calculating volatility index:', error);
      return 0;
    }
  }

  /**
   * Applies daily movement clamp to prevent excessive volatility
   */
  private async applyDailyClamp(avgxValue: number): Promise<number> {
    try {
      const history = await this.getAvgxHistory();
      if (history.length === 0) return avgxValue;

      const lastAvgx = history[history.length - 1].avgx_usd;
      const maxChange = lastAvgx * this.config.clamp_percent;

      // Clamp the change to ±1.5% per day
      const change = avgxValue - lastAvgx;
      const clampedChange = Math.max(-maxChange, Math.min(maxChange, change));

      return lastAvgx + clampedChange;
    } catch (error) {
      console.error('Error applying daily clamp:', error);
      return avgxValue;
    }
  }

  /**
   * Stores smoothed values for historical tracking
   */
  private async storeSmoothedValues(smoothedValues: SmoothedValues, avgxValue: number): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const data = {
        timestamp,
        wf_smoothed: smoothedValues.wf_smoothed,
        wc_smoothed: smoothedValues.wc_smoothed,
        volatility_index: smoothedValues.volatility_index,
        wc_adjusted: smoothedValues.wc_adjusted,
        avgx_usd: avgxValue
      };

      // Store in history file (keep last 100 entries)
      const history = await this.getSmoothedHistory();
      history.push(data);

      // Keep only recent entries
      const recentHistory = history.slice(-100);

      await FileManager.writeJson('smoothed_history.json', recentHistory);
    } catch (error) {
      console.error('Error storing smoothed values:', error);
    }
  }

  /**
   * Gets smoothed values history for EWMA calculation
   */
  private async getSmoothedHistory(): Promise<any[]> {
    try {
      return await FileManager.readJson<any[]>('smoothed_history.json') || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Gets AVGX history for clamping calculation
   */
  private async getAvgxHistory(): Promise<any[]> {
    try {
      return await FileManager.readJson<any[]>('history.json') || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Gets debug information showing intermediate values in the stability formula
   */
  public async getDebugInfo(): Promise<{
    wf_raw: number;
    wf_smoothed: number;
    wc_raw: number;
    wc_smoothed: number;
    volatility_index: number;
    wc_adjusted: number;
    avgx_final: number;
    config: StabilityConfig;
    timestamp: string;
  }> {
    try {
      const [fiatRates, cryptoPrices] = await Promise.all([
        fiatApiService.getFiatRatesWithWeights(),
        cryptoApiService.getCryptoPricesWithWeights()
      ]);

      // Calculate raw weighted baskets
      const wfRaw = fiatRates.reduce((sum, fiat) => sum + (fiat.rate * fiat.weight), 0);
      const wcRaw = cryptoPrices.reduce((sum, crypto) => sum + (crypto.price * crypto.weight), 0);

      // Apply stability formula
      const smoothedValues = await this.calculateSmoothedValues(wfRaw, wcRaw);

      // Calculate final AVGX
      const avgxValue = Math.sqrt(smoothedValues.wf_smoothed * smoothedValues.wc_adjusted);
      const clampedAvgxValue = await this.applyDailyClamp(avgxValue);

      return {
        wf_raw: wfRaw,
        wf_smoothed: smoothedValues.wf_smoothed,
        wc_raw: wcRaw,
        wc_smoothed: smoothedValues.wc_smoothed,
        volatility_index: smoothedValues.volatility_index,
        wc_adjusted: smoothedValues.wc_adjusted,
        avgx_final: clampedAvgxValue,
        config: this.config,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting debug info:', error);
      throw error;
    }
  }
}

export const avgxCalculatorService = new AvgxCalculatorService();