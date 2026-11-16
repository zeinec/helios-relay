// economy.js — HELIOS RELAY money rules. No HUD, no DOM; testable alone.

export const PAYOUTS = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  lossBonus: 500,
  lossCap: 3400,
};

// Buy-menu digits 1-9. Weapons/gear persist in `owned`; grenades are consumables.
export const SHOP = [
  { id: 'pistol', kind: 'weapon', name: 'Sidewinder Pistol', price: 0, key: '1', desc: 'Free sidearm, always owned' },
  { id: 'smg', kind: 'weapon', name: 'Hornet SMG', price: 1500, key: '2', desc: 'Fast close-range spray' },
  { id: 'rifle', kind: 'weapon', name: 'Longbow Rifle', price: 2700, key: '3', desc: 'Accurate all-rounder' },
  { id: 'sniper', kind: 'weapon', name: 'Meridian Sniper', price: 4750, key: '4', desc: 'One-shot body kill, scoped' },
  { id: 'kevlar', kind: 'gear', name: 'Kevlar Vest', price: 650, key: '5', desc: 'Halves damage taken' },
  { id: 'kit', kind: 'gear', name: 'Defuse Kit', price: 400, key: '6', desc: 'Defenders only: 2.5 s defuse' },
  { id: 'flash', kind: 'grenade', name: 'Flash Grenade', price: 200, key: '7', desc: 'Blinds anyone looking at the pop' },
  { id: 'smoke', kind: 'grenade', name: 'Smoke Grenade', price: 300, key: '8', desc: '12 s sight-blocking cloud' },
  { id: 'he', kind: 'grenade', name: 'HE Grenade', price: 300, key: '9', desc: 'Area blast, bots hear it' },
];

export function shopItem(id) {
  return SHOP.find((item) => item.id === id) ?? null;
}

export function createEconomy() {
  const eco = {
    money: PAYOUTS.start,
    lossStreak: 0,
    owned: new Set(['pistol']),

    canAfford(item) {
      return Boolean(item) && this.money >= item.price;
    },

    // False when unaffordable; otherwise deducts and keeps weapons/gear.
    buy(item) {
      if (!this.canAfford(item)) return false;
      this.money -= item.price;
      if (item.kind === 'weapon' || item.kind === 'gear') this.owned.add(item.id);
      return true;
    },

    awardKill() {
      this.money += PAYOUTS.kill;
    },

    // Win resets the loss streak; loss pays a capped, streak-growing bonus.
    awardRound(won) {
      if (won) {
        this.money += PAYOUTS.win;
        this.lossStreak = 0;
      } else {
        this.money += Math.min(PAYOUTS.lossCap, PAYOUTS.loss + PAYOUTS.lossBonus * this.lossStreak);
        this.lossStreak += 1;
      }
    },

    reset() {
      this.money = PAYOUTS.start;
      this.lossStreak = 0;
      this.owned = new Set(['pistol']);
    },
  };
  return eco;
}
