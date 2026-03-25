/** Fluent builder for Pump.fun fee sharing configurations. */

import { WALLET_PLACEHOLDER } from "../utils/constants.js";

const BPS_TOTAL = 10_000;
const MAX_FEE_CLAIMERS = 100;

/** A single fee recipient with wallet address and basis points allocation. */
interface FeeRecipient {
  address: string;
  bps: number;
}

/** Validation result from the builder. */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Output from the builder — ready for createLaunchSession. */
interface FeeConfigOutput {
  claimersArray: string[];
  basisPointsArray: number[];
}

/**
 * Fluent builder for constructing fee split configurations.
 * Validates BPS sum, duplicates, and claimer limits before output.
 */
export class FeeConfigBuilder {
  private recipients: FeeRecipient[] = [];

  private constructor() {}

  /**
   * Create a new empty builder.
   * @returns A fresh FeeConfigBuilder instance.
   */
  static create(): FeeConfigBuilder {
    return new FeeConfigBuilder();
  }

  /**
   * Add a fee recipient with a specific BPS allocation.
   * @param address - Wallet address or WALLET_PLACEHOLDER for deployer.
   * @param bps - Basis points (1-10000).
   * @returns This builder for chaining.
   */
  addRecipient(address: string, bps: number): this {
    this.recipients.push({ address, bps });
    return this;
  }

  /**
   * Distribute BPS evenly across a list of wallet addresses.
   * @param addresses - Wallet addresses to split evenly.
   * @returns This builder for chaining.
   */
  splitEvenly(addresses: string[]): this {
    if (addresses.length === 0) return this;
    const perRecipient = Math.floor(BPS_TOTAL / addresses.length);
    const remainder = BPS_TOTAL - perRecipient * addresses.length;

    for (let i = 0; i < addresses.length; i++) {
      const bps = i === 0 ? perRecipient + remainder : perRecipient;
      this.recipients.push({ address: addresses[i], bps });
    }
    return this;
  }

  /**
   * Validate the current configuration.
   * @returns Validation result with any error messages.
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    if (this.recipients.length === 0) {
      errors.push("At least one recipient required");
    }
    if (this.recipients.length > MAX_FEE_CLAIMERS) {
      errors.push(`Maximum ${MAX_FEE_CLAIMERS} recipients allowed`);
    }

    const sum = this.recipients.reduce((acc, r) => acc + r.bps, 0);
    if (sum !== BPS_TOTAL) {
      errors.push(`BPS total is ${sum}, must be exactly ${BPS_TOTAL}`);
    }

    for (let i = 0; i < this.recipients.length; i++) {
      if (this.recipients[i].bps <= 0) {
        errors.push(`Recipient ${i} has zero or negative BPS`);
      }
    }

    const seen = new Set<string>();
    for (const r of this.recipients) {
      if (seen.has(r.address)) {
        errors.push(`Duplicate address: ${r.address}`);
      }
      seen.add(r.address);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Build the final output for use with createLaunchSession.
   * Throws if validation fails.
   * @returns Claimers array and basis points array.
   */
  build(): FeeConfigOutput {
    const result = this.validate();
    if (!result.valid) {
      throw new Error(`Invalid fee config: ${result.errors.join(", ")}`);
    }
    return {
      claimersArray: this.recipients.map((r) => r.address),
      basisPointsArray: this.recipients.map((r) => r.bps),
    };
  }

  /**
   * 100% of fees to the deployer (resolved at signing time).
   * @returns A pre-configured builder.
   */
  static soloCreator(): FeeConfigBuilder {
    return FeeConfigBuilder.create().addRecipient(WALLET_PLACEHOLDER, BPS_TOTAL);
  }

  /**
   * Split fees between creator and additional recipients.
   * @param creatorBps - BPS allocation for the creator (default 5000 = 50%).
   * @param otherAddresses - Additional wallet addresses that split the remainder evenly.
   * @returns A pre-configured builder.
   */
  static creatorPlusSplit(creatorBps: number, otherAddresses: string[]): FeeConfigBuilder {
    const builder = FeeConfigBuilder.create().addRecipient(WALLET_PLACEHOLDER, creatorBps);
    if (otherAddresses.length === 0) return builder;

    const remaining = BPS_TOTAL - creatorBps;
    const perOther = Math.floor(remaining / otherAddresses.length);
    const remainder = remaining - perOther * otherAddresses.length;

    for (let i = 0; i < otherAddresses.length; i++) {
      const bps = i === 0 ? perOther + remainder : perOther;
      builder.addRecipient(otherAddresses[i], bps);
    }
    return builder;
  }

  /**
   * Even split among a team of wallet addresses.
   * @param members - Team member wallet addresses.
   * @returns A pre-configured builder.
   */
  static teamSplit(members: string[]): FeeConfigBuilder {
    return FeeConfigBuilder.create().splitEvenly(members);
  }
}
