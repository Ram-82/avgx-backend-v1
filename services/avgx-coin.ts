import { avgxCoinTransactions, avgxReserves, pegData, type InsertTransaction, type InsertReserves, type InsertPegData } from "@shared/schema";
import { storage } from "../storage";
import { avgxCalculatorService } from "./avgx-calculator";

export class AvgxCoinService {
  // Get current peg status and reserves
  async getPegStatus() {
    const avgxIndex = await avgxCalculatorService.getCurrentAvgx();
    const reserves = await storage.getLatestReserves();
    
    const pegDeviation = reserves ? 
      ((parseFloat(reserves.backingValue) - avgxIndex.avgx_usd) / avgxIndex.avgx_usd * 100) : 0;

    return {
      avgxIndex: avgxIndex.avgx_usd,
      coinPrice: avgxIndex.avgx_usd, // Pegged 1:1 to index
      pegDeviation,
      totalSupply: reserves?.totalSupply || "0",
      backingValue: reserves?.backingValue || "0",
      collateralRatio: reserves?.collateralRatio || "1.0000",
      pegHealth: Math.abs(pegDeviation) < 0.5 ? "healthy" : "needs_rebalance",
      timestamp: new Date().toISOString()
    };
  }

  // Calculate mint amount for a given USD value
  async calculateMintAmount(usdValue: number) {
    const avgxData = await avgxCalculatorService.getCurrentAvgx();
    const avgxAmount = usdValue / avgxData.avgx_usd;
    
    return {
      avgxAmount,
      avgxPrice: avgxData.avgx_usd,
      usdValue,
      fee: usdValue * 0.003, // 0.3% fee
      total: usdValue + (usdValue * 0.003)
    };
  }

  // Calculate redeem value for a given AVGX amount
  async calculateRedeemValue(avgxAmount: number) {
    const avgxData = await avgxCalculatorService.getCurrentAvgx();
    const usdValue = avgxAmount * avgxData.avgx_usd;
    
    return {
      avgxAmount,
      avgxPrice: avgxData.avgx_usd,
      usdValue,
      fee: usdValue * 0.003, // 0.3% fee
      netValue: usdValue - (usdValue * 0.003)
    };
  }

  // Record a new transaction
  async recordTransaction(transaction: InsertTransaction) {
    return await storage.createTransaction(transaction);
  }

  // Get transaction history for a wallet
  async getTransactionHistory(walletAddress: string, limit: number = 50) {
    return await storage.getTransactionHistory(walletAddress, limit);
  }

  // Update reserves after transaction
  async updateReserves(reserves: InsertReserves) {
    return await storage.updateReserves(reserves);
  }

  // Get reserve breakdown showing backing assets
  async getReserveBreakdown() {
    const reserves = await storage.getLatestReserves();
    const breakdown = await avgxCalculatorService.getDetailedBreakdown();
    
    if (!reserves) {
      return {
        totalSupply: "0",
        backingValue: "0",
        fiatReserves: {},
        cryptoReserves: {},
        breakdown: breakdown
      };
    }

    return {
      totalSupply: reserves.totalSupply,
      backingValue: reserves.backingValue,
      collateralRatio: reserves.collateralRatio,
      fiatReserves: reserves.fiatReserves,
      cryptoReserves: reserves.cryptoReserves,
      breakdown: breakdown
    };
  }

  // Simulate trading operations for demo
  async simulateTrade(type: 'mint' | 'redeem', amount: number, chain: string) {
    const avgxData = await avgxCalculatorService.getCurrentAvgx();
    
    let avgxAmount: number;
    let usdValue: number;
    
    if (type === 'mint') {
      // amount is USD value to mint
      avgxAmount = amount / avgxData.avgx_usd;
      usdValue = amount;
    } else {
      // amount is AVGX to redeem
      avgxAmount = amount;
      usdValue = amount * avgxData.avgx_usd;
    }

    const fee = usdValue * 0.003; // 0.3% fee
    const transactionHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    return {
      transactionHash,
      type,
      avgxAmount,
      usdValue,
      fee,
      avgxPrice: avgxData.avgx_usd,
      chain,
      status: 'confirmed',
      timestamp: new Date().toISOString()
    };
  }

  // Get trading statistics
  async getTradingStats() {
    const transactions = await storage.getAllTransactions();
    const reserves = await storage.getLatestReserves();
    
    const totalVolume = transactions.reduce((sum: number, tx: any) => 
      sum + (parseFloat(tx.amount) * parseFloat(tx.avgxPrice)), 0);
    
    const mintTransactions = transactions.filter((tx: any) => tx.type === 'mint');
    const redeemTransactions = transactions.filter((tx: any) => tx.type === 'redeem');
    
    return {
      totalSupply: reserves?.totalSupply || "0",
      totalVolume24h: totalVolume,
      mintCount24h: mintTransactions.length,
      redeemCount24h: redeemTransactions.length,
      averageTransactionSize: transactions.length > 0 ? totalVolume / transactions.length : 0,
      uniqueWallets: new Set(transactions.map((tx: any) => tx.walletAddress)).size
    };
  }

  // Get coin status - alias for getPegStatus
  async getCoinStatus() {
    return await this.getPegStatus();
  }

  // Get coin stats - alias for getTradingStats
  async getCoinStats() {
    return await this.getTradingStats();
  }
}

export const avgxCoinService = new AvgxCoinService();